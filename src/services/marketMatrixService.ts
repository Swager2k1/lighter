import { getEarningsInfo, getReportingWeekInterval } from './calendarService.js';
import { readLighterAccount } from '../connectors/lighter.js';
import { getHedgeWallet } from './positionSyncService.js';
import { loadConfig, getActiveHedges, FullConfig } from '../config.js';

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface DynamicNotionalSizing {
  totalEquity: number;
  margin100Pct: number;
  notional100Pct: number;
  margin50Pct: number;
  notional50Pct: number;
}

export interface OrderbookWalkResult {
  exhausted: boolean;
  executedNotional: number;
  baseQuantity: number;
  avgSellPrice: number;
  avgBuyPrice: number;
  lossUsd: number;
  lossPct: number;
}

export interface MarketMatrixRow {
  symbol: string;
  type: string;
  isStock: boolean;
  earningsText: string;
  hasEarningsBoost: boolean;
  daysUntilEarnings: number;
  loss100Usd: number;
  loss100Pct: number;
  loss50Usd: number;
  loss50Pct: number;
  oiRobinhoodUsd: number;
  oiArbitrumUsd: number;
  wallRhL1: string;
  wallRhL2: string;
  wallArbL1: string;
  wallArbL2: string;
  maxEntryWallUsd: number;
  edgeSpreadPct: number;
  macroRisk: string;
  verdict: string;
  isNewListing?: boolean;
  fullDepth?: boolean;
  halfDepth?: boolean;
  availableFull?: boolean;
  availableHalf?: boolean;
  fullSize?: number;
  halfSize?: number;
  observedAt?: string;
  unavailableReason?: string;
}

export const KNOWN_STOCKS = new Set([
  'AAPL', 'AMD', 'AMZN', 'BABA', 'COIN', 'GOOGL', 'INTC', 'META', 'MSFT',
  'MU', 'NVDA', 'ORCL', 'PLTR', 'SKHY', 'SNDK', 'TSLA', 'TSM', 'BMNR'
]);

export const KNOWN_PRE_IPO = new Set([
  'SHEIN', 'CRWV', 'CRCL', 'SPCX', 'OPENAI', 'ANTHROPIC'
]);

export const KNOWN_ETF = new Set([
  'QQQ', 'SPY', 'SOXL', 'SPX', 'IWM'
]);

export const KNOWN_COMMODITIES = new Set([
  'XAU', 'XAG', 'WTI', 'BRENTOIL', 'NATGAS'
]);

const ASSET_MACRO_INFO: Record<string, string> = {
  MSFT: '🟡 Azure Cloud / AI Capex',
  GOOGL: '🟡 Антимонополия / Поисковый AI',
  AMZN: '🟡 AWS / E-commerce',
  COIN: '🟡 Крипто-рынок / ETF объемы',
  INTC: '🟡 Реструктуризация / Foundry',
  AAPL: '🟡 Спрос iPhone / Услуги',
  PLTR: '🟡 AI оборонка / Государственные контракты',
  AMD: '🟡 Конкуренция GPU / Дата-центры',
  NVDA: '🟡 Лидер AI / Blackwell спрос',
  META: '🟢 Capex AI / Рекламная выручка',
  TSLA: '🟢 Robotaxi / Спрос на EV',
  TSM: '🟢 CHIPS / Передовые узлы',
  ORCL: '🟢 Безопасно (Cloud / AI)',
  BABA: '🟡 Пошлины США-КНР / Стимулы',
  MU: '🟢 Цикл памяти DRAM / HBM',
  SKHY: '🟢 HBM спрос (Nvidia партнер)',
  SNDK: '🟢 Флеш-память / Стабильно',
  BMNR: '🟡 Майнинг / Хэшрейт BTC',
  SHEIN: '🔴 Тонкий стакан / Регуляторы',
  CRWV: '🟡 Low OI / Средний стакан',
  CRCL: '🟡 Low OI / Умеренно',
  SPCX: '🟡 Космос / Low OI',
  OPENAI: '🔴 Тонкий стакан / Частные оценки',
  ANTHROPIC: '🔴 Тонкий стакан / Частные оценки',
  QQQ: '🟢 Высокая ликвидность (Nasdaq 100)',
  SPY: '🟢 Макро-базовый (S&P 500)',
  SOXL: '🔴 3x Леверидж (Повышенная волатильность)',
  XAU: '🟢 Золото / Макро-хедж',
  XAG: '🟢 Серебро / Волатильность',
};

export function isStockSymbol(symbol: string): boolean {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').split('/')[0];
  return KNOWN_STOCKS.has(norm);
}

export function getAssetType(symbol: string): 'Stock' | 'Pre-IPO' | 'ETF' | 'Commodity' | 'Crypto' {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').split('/')[0];
  if (KNOWN_STOCKS.has(norm)) return 'Stock';
  if (KNOWN_PRE_IPO.has(norm)) return 'Pre-IPO';
  if (KNOWN_ETF.has(norm)) return 'ETF';
  if (KNOWN_COMMODITIES.has(norm)) return 'Commodity';
  return 'Crypto';
}

export function getAssetMacroRisk(symbol: string): string {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').split('/')[0];
  return ASSET_MACRO_INFO[norm] || '🟢 Стандартный рыночный риск';
}

export function checkIsNewListing(createdAt: string | number | undefined, weekStart: Date): boolean {
  if (!createdAt) return false;
  const ts = typeof createdAt === 'string' ? parseInt(createdAt, 10) : createdAt;
  if (!ts || isNaN(ts)) return false;
  const ms = ts > 1e11 ? ts : ts * 1000;
  return ms >= weekStart.getTime();
}

export interface HedgeabilityParams {
  rhDetail?: {
    symbol?: string;
    status?: string;
    is_frozen?: boolean;
    open_interest?: number | string;
    market_config?: { force_reduce_only?: boolean };
  };
  arbDetail?: {
    symbol?: string;
    status?: string;
    is_frozen?: boolean;
    open_interest?: number | string;
    open_interest_usd?: number | string;
    market_config?: { force_reduce_only?: boolean };
  };
  rhBidsCount: number;
  rhAsksCount: number;
  arbBidsCount: number;
  arbAsksCount: number;
}

export function validateMarketHedgeability(params: HedgeabilityParams): { isHedgeable: boolean; reason?: string } {
  const { rhDetail, arbDetail, rhBidsCount, rhAsksCount, arbBidsCount, arbAsksCount } = params;

  if (!rhDetail || !arbDetail) {
    return { isHedgeable: false, reason: 'Инструмент отсутствует на одной из бирж' };
  }

  if (rhDetail.status !== 'active' || arbDetail.status !== 'active') {
    return { isHedgeable: false, reason: `Статус не active (RH: ${rhDetail.status}, Arb: ${arbDetail.status})` };
  }

  if (rhDetail.is_frozen || arbDetail.is_frozen) {
    return { isHedgeable: false, reason: 'Рынок заморожен (is_frozen: true)' };
  }

  if (rhDetail.market_config?.force_reduce_only || arbDetail.market_config?.force_reduce_only) {
    return { isHedgeable: false, reason: 'force_reduce_only включен (запрет на открытие новых позиций)' };
  }

  const rhOi = parseFloat(String(rhDetail.open_interest || '0'));
  const arbOi = parseFloat(String(arbDetail.open_interest || '0'));
  const arbOiUsd = parseFloat(String(arbDetail.open_interest_usd || '0'));
  if (rhOi <= 0 || (arbOi <= 0 && arbOiUsd <= 0)) {
    return { isHedgeable: false, reason: `Нулевой Open Interest (RH: ${rhOi}, Arb: ${arbOi})` };
  }

  if (rhBidsCount === 0 || rhAsksCount === 0 || arbBidsCount === 0 || arbAsksCount === 0) {
    return { isHedgeable: false, reason: `Пустой стакан ордеров (RH b:${rhBidsCount} a:${rhAsksCount}, Arb b:${arbBidsCount} a:${arbAsksCount})` };
  }

  return { isHedgeable: true };
}

export function sortMarketMatrixRows(rows: MarketMatrixRow[]): MarketMatrixRow[] {
  return [...rows].sort((a, b) => {
    // 1. Секция бустов (🔥 отчет недели или новый листинг) идет на самом верху
    if (a.hasEarningsBoost && !b.hasEarningsBoost) return -1;
    if (!a.hasEarningsBoost && b.hasEarningsBoost) return 1;

    // Внутри бустов: фильтр по WOS Market 100% от самых низких затрат к самым высоким
    if (a.hasEarningsBoost && b.hasEarningsBoost) {
      if (Math.abs(a.loss100Pct - b.loss100Pct) > 1e-5) {
        return a.loss100Pct - b.loss100Pct;
      }
      return a.oiRobinhoodUsd - b.oiRobinhoodUsd;
    }

    // 2. Секция Акций (без буста) идет перед остальными рынками
    if (a.isStock && !b.isStock) return -1;
    if (!a.isStock && b.isStock) return 1;

    // 3. Внутри категории (акции без буста ИЛИ другие рынки без буста):
    // Фильтр по WOS Market 100% от самых низких затрат к самым высоким
    if (Math.abs(a.loss100Pct - b.loss100Pct) > 1e-5) {
      return a.loss100Pct - b.loss100Pct;
    }

    // При строго одинаковом лоссе — по возрастанию Robinhood OI
    return a.oiRobinhoodUsd - b.oiRobinhoodUsd;
  });
}

export function calculateDynamicNotional(totalEquity: number, leverage = 7): DynamicNotionalSizing {
  const safeEquity = Number.isFinite(totalEquity) && totalEquity > 0 ? totalEquity : 0;
  const margin100Pct = Math.floor(safeEquity * 50) / 100;
  const notional100Pct = parseFloat((margin100Pct * leverage).toFixed(2));
  const margin50Pct = Math.floor(safeEquity * 25) / 100;
  const notional50Pct = parseFloat((margin50Pct * leverage).toFixed(2));

  return {
    totalEquity: safeEquity,
    margin100Pct,
    notional100Pct,
    margin50Pct,
    notional50Pct,
  };
}

export function fillBookQuantity(levels: OrderbookLevel[], quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  let remaining = quantity;
  let cash = 0;
  for (const level of levels) {
    if (!(level.price > 0 && level.size > 0)) continue;
    const take = Math.min(remaining, level.size);
    cash += take * level.price;
    remaining -= take;
    if (remaining <= 1e-9) return { cash, average: cash / quantity };
  }
  return null;
}

export function simulateOrderbookWalk(params: {
  targetNotional: number;
  sellSideLevels: OrderbookLevel[];
  buySideLevels: OrderbookLevel[];
  sizeDecimals?: number;
}): OrderbookWalkResult {
  const { targetNotional, sellSideLevels, buySideLevels } = params;
  if (!(Number.isFinite(targetNotional) && targetNotional > 0)) throw new Error('Invalid target notional');
  const unitsAtBudget = (levels: OrderbookLevel[]) => {
    let remaining = targetNotional;
    let units = 0;
    for (const level of levels) {
      if (!(level.price > 0 && level.size > 0)) continue;
      const cash = Math.min(remaining, level.size * level.price);
      units += cash / level.price;
      remaining -= cash;
      if (remaining <= 1e-8) break;
    }
    return { units, exhausted: remaining > 1e-8 };
  };
  const sellCapacity = unitsAtBudget(sellSideLevels);
  const buyCapacity = unitsAtBudget(buySideLevels);
  const capacity = Math.min(sellCapacity.units, buyCapacity.units);
  const scale = 10 ** (params.sizeDecimals ?? 8);
  const baseQuantity = Math.floor(capacity * scale) / scale;
  const sell = fillBookQuantity(sellSideLevels, baseQuantity);
  const buy = fillBookQuantity(buySideLevels, baseQuantity);
  const loss = sell && buy ? buy.cash - sell.cash : 0;
  return {
    exhausted: sellCapacity.exhausted || buyCapacity.exhausted || !sell || !buy,
    baseQuantity,
    executedNotional: sell?.cash ?? 0,
    avgSellPrice: sell?.average ?? 0,
    avgBuyPrice: buy?.average ?? 0,
    lossUsd: Number(loss.toFixed(2)),
    lossPct: sell?.cash ? Number((100 * loss / sell.cash).toFixed(3)) : 0,
  };
}

export function formatCompactUsd(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}k`;
  }
  return `$${amount.toFixed(0)}`;
}

function formatScenarioLoss(lossUsd: number, lossPct: number): string {
  const usd = Math.abs(lossUsd).toFixed(2);
  const pct = Math.abs(lossPct).toFixed(3);
  if (lossUsd === 0) return '$0.00 (0.000%)';
  return lossUsd < 0 ? `+$${usd} (+${pct}%)` : `-$${usd} (${pct}%)`;
}

export function formatTopCardsMessage(params: {
  walletsSummary: string;
  sizing: DynamicNotionalSizing;
  topRows: MarketMatrixRow[];
  mode: 'open' | 'close';
}): string {
  const { walletsSummary, sizing, topRows, mode } = params;
  const title = mode === 'open' ? '🚀 ТОП-5 ДЛЯ ВХОДА В СВЯЗКУ (/o)' : '🛑 ТОП-5 РАСХОДОВ НА ЗАКРЫТИЕ (/c)';

  const lines = [
    `📊 *ОНЧЕЙН-БАЛАНСЫ ПОРТФЕЛЯ (LIVE)*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    walletsSummary,
    `• 100% Notional (7x): *$${sizing.notional100Pct}* (маржа: $${sizing.margin100Pct})`,
    `• 50% Notional (7x): *$${sizing.notional50Pct}* (маржа: $${sizing.margin50Pct})`,
    ``,
  ];

  if (mode === 'open') {
    lines.push('RH SHORT + Core LONG. Оценка по снимкам стаканов, без комиссий и funding. Количество на обеих ногах одинаковое. Сценарий предполагает установленное плечо 7×.', '');
  }

  lines.push(
    `🏆 *${title}*`,
    `Сначала доступные сценарии 100%, затем рынки с расчётом на 50%.`,
    `━━━━━━━━━━━━━━━━━━━━`
  );

  if (!topRows.length) lines.push('Нет доступных оценок на 100% или 50%. Ограничения по рынкам указаны в JSON.');
  topRows.forEach((r, idx) => {
    let categoryBadge = r.isStock ? '📈 [АКЦИЯ]' : '🌐 [ДРУГОЙ РЫНОК]';
    if (r.hasEarningsBoost) {
      categoryBadge = r.isNewListing ? '🔥 [НОВЫЙ ЛИСТИНГ]' : '🔥 [БУСТ ОТЧЕТА]';
    }

    const full = r.availableFull === false
      ? r.unavailableReason ?? (r.fullDepth === false ? 'недостаточно глубины' : 'оценка недоступна')
      : formatScenarioLoss(r.loss100Usd, r.loss100Pct);
    const half = r.availableHalf === false
      ? (r.halfDepth === false ? 'недостаточно глубины' : 'оценка недоступна')
      : formatScenarioLoss(r.loss50Usd, r.loss50Pct);

    lines.push(
      `${idx + 1}. *$${r.symbol}* ${categoryBadge} (${r.earningsText})`,
      `   🔹 *100% — полный объём*   *${full}*`,
      `   🔸 *50% — половина объёма*   *${half}*`,
      `   • OI RH: *${formatCompactUsd(r.oiRobinhoodUsd)}* 🟢 | OI Arb: *${formatCompactUsd(r.oiArbitrumUsd)}*`,
      `   • Стенки RH/Arb: *${r.wallRhL1}* / *${r.wallArbL1}* (макс 1 стенка: $${r.maxEntryWallUsd})`,
      `   • Спред краёв: *${r.edgeSpreadPct}%*`,
      ``
    );
  });

  lines.push(`📎 *Полная каноническая матрица по всем инструментам прикреплена в JSON файле ниже.*`);
  return lines.join('\n');
}

export function generateCanonicalJsonFile(rows: MarketMatrixRow[], sizing: DynamicNotionalSizing, wallet?: string, mode: 'open' | 'close' = 'open'): string {
  // 1. Разделение на три секции: Бусты -> Акции (без буста) -> Другие рынки (без буста)
  const boosts = rows.filter((r) => r.hasEarningsBoost);
  const stocks = rows.filter((r) => r.isStock && !r.hasEarningsBoost);
  const otherMarkets = rows.filter((r) => !r.isStock && !r.hasEarningsBoost);

  // Каждая секция упорядочена от самых низких затрат к самым высоким (по WOS Market 100%)
  const sortedBoosts = [...boosts].sort((a, b) => a.loss100Pct - b.loss100Pct || a.oiRobinhoodUsd - b.oiRobinhoodUsd);
  const sortedStocks = [...stocks].sort((a, b) => a.loss100Pct - b.loss100Pct || a.oiRobinhoodUsd - b.oiRobinhoodUsd);
  const sortedOther = [...otherMarkets].sort((a, b) => a.loss100Pct - b.loss100Pct || a.oiRobinhoodUsd - b.oiRobinhoodUsd);

  const orderedMarkets = [...sortedBoosts, ...sortedStocks, ...sortedOther];

  const formatRow = (
    r: MarketMatrixRow,
    index: number,
    sectionType?: 'boosts' | 'stocks' | 'other' | 'all'
  ) => {
    let divider: string | null = null;
    if (sectionType === 'all') {
      if (index === 0 && sortedBoosts.length > 0) {
        divider = '══════════ СЕКЦИЯ БУСТОВ НЕДЕЛИ (BOOSTS) ══════════';
      } else if (index === sortedBoosts.length && sortedStocks.length > 0) {
        divider = '══════════ СЕКЦИЯ АКЦИЙ (STOCKS) ══════════';
      } else if (index === sortedBoosts.length + sortedStocks.length && sortedOther.length > 0) {
        divider = '══════════ ДРУГИЕ РЫНКИ (CRYPTO / ETF / COMMODITIES / PRE-IPO) ══════════';
      }
    } else if (sectionType === 'boosts' && index === 0) {
      divider = '══════════ СЕКЦИЯ БУСТОВ НЕДЕЛИ (BOOSTS) ══════════';
    } else if (sectionType === 'stocks' && index === 0) {
      divider = '══════════ СЕКЦИЯ АКЦИЙ (STOCKS) ══════════';
    } else if (sectionType === 'other' && index === 0) {
      divider = '══════════ ДРУГИЕ РЫНКИ (CRYPTO / ETF / COMMODITIES / PRE-IPO) ══════════';
    }

    return {
      ...(divider ? { divider } : {}),
      rank: index + 1,
      symbol: r.symbol,
      loss_market_100pct: r.availableFull === false ? null : formatScenarioLoss(r.loss100Usd, r.loss100Pct),
      loss_market_50pct: r.availableHalf === false ? null : formatScenarioLoss(r.loss50Usd, r.loss50Pct),
      type: r.type,
      is_stock: r.isStock,
      has_boost: r.hasEarningsBoost,
      earnings: r.earningsText,
      days_until_earnings: r.daysUntilEarnings < 9999 ? r.daysUntilEarnings : null,
      sufficient_depth_100pct: r.fullDepth ?? null,
      matched_quantity_100pct: r.availableFull === false ? null : r.fullSize ?? null,
      sufficient_depth_50pct: r.halfDepth ?? null,
      matched_quantity_50pct: r.availableHalf === false ? null : r.halfSize ?? null,
      observed_at: r.observedAt ?? null,
      unavailable_reason: r.unavailableReason ?? null,
      oi_robinhood: formatCompactUsd(r.oiRobinhoodUsd),
      oi_arbitrum: formatCompactUsd(r.oiArbitrumUsd),
      walls_rh_bid_l1_l2: `${r.wallRhL1} / ${r.wallRhL2}`,
      walls_arb_ask_l1_l2: `${r.wallArbL1} / ${r.wallArbL2}`,
      max_entry_wall_usd: `$${r.maxEntryWallUsd}`,
      edge_spread_pct: `${r.edgeSpreadPct}%`,
      macro_risk: r.macroRisk,
      verdict: r.verdict,
    };
  };

  const data = {
    generated_at: new Date().toISOString(),
    wallet,
    direction: mode === 'open' ? 'RH SHORT / Core LONG' : 'RH buy / Core sell',
    includes_fees_or_funding: false,
    portfolio_equity_usd: Number.isFinite(sizing.totalEquity) ? sizing.totalEquity : null,
    margin_per_leg_100pct_usd: sizing.margin100Pct,
    notional_100pct_7x_usd: sizing.notional100Pct,
    notional_50pct_7x_usd: sizing.notional50Pct,
    total_markets: orderedMarkets.length,
    total_boosts: sortedBoosts.length,
    total_stocks: sortedStocks.length,
    total_other_markets: sortedOther.length,
    boosts_section: sortedBoosts.map((r, idx) => formatRow(r, idx, 'boosts')),
    stocks_section: sortedStocks.map((r, idx) => formatRow(r, idx, 'stocks')),
    other_markets_section: sortedOther.map((r, idx) => formatRow(r, idx, 'other')),
    markets: orderedMarkets.map((r, idx) => formatRow(r, idx, 'all')),
  };

  return JSON.stringify(data, null, 2);
}

export function generateCanonicalMarkdownFile(rows: MarketMatrixRow[], sizing: DynamicNotionalSizing): string {
  return generateCanonicalJsonFile(rows, sizing);
}

interface LighterOrderBookItem {
  price: string;
  size?: string;
  remaining_base_amount?: string;
  initial_base_amount?: string;
}

interface LighterOrderBookResponse {
  bids?: LighterOrderBookItem[];
  asks?: LighterOrderBookItem[];
  order_book_orders?: {
    bids?: LighterOrderBookItem[];
    asks?: LighterOrderBookItem[];
  };
}

export async function fetchOrderBookOrders(
  venue: 'rh' | 'arb',
  marketId: number,
  limit = 50
): Promise<{ bids: OrderbookLevel[]; asks: OrderbookLevel[] }> {
  const baseUrl = venue === 'rh' ? 'https://api.rh.lighter.xyz' : 'https://mainnet.zklighter.elliot.ai';
  const url = `${baseUrl}/api/v1/orderBookOrders?market_id=${marketId}&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return { bids: [], asks: [] };

    const data = (await res.json()) as LighterOrderBookResponse;
    const rawBids = data.bids || data.order_book_orders?.bids || [];
    const rawAsks = data.asks || data.order_book_orders?.asks || [];

    const bids: OrderbookLevel[] = rawBids.map((b) => ({
      price: parseFloat(b.price) || 0,
      size: parseFloat(b.remaining_base_amount || b.initial_base_amount || b.size || '0') || 0,
    }));
    const asks: OrderbookLevel[] = rawAsks.map((a) => ({
      price: parseFloat(a.price) || 0,
      size: parseFloat(a.remaining_base_amount || a.initial_base_amount || a.size || '0') || 0,
    }));

    return {
      bids: bids.filter((level) => level.price > 0 && level.size > 0).sort((a, b) => b.price - a.price),
      asks: asks.filter((level) => level.price > 0 && level.size > 0).sort((a, b) => a.price - b.price),
    };
  } catch {
    return { bids: [], asks: [] };
  }
}

export async function scanCanonicalMarketMatrix(
  mode: 'open' | 'close' = 'open',
  targetWalletArg?: 'w1' | 'w2' | 'all'
): Promise<{
  topCardsText: string;
  fileContent: string;
}> {
  const config = loadConfig();
  const w1Addr = config.wallets.robinhoodWallet1?.trim() || '';
  const w2Addr = config.wallets.robinhoodWallet2?.trim() || '';

  const active = getActiveHedges(config);
  const occupied = (slot: 'w1' | 'w2') => active.some((hedge) => getHedgeWallet(config, hedge)?.slot === slot);
  const selected = targetWalletArg ?? (w2Addr && (!w1Addr || (occupied('w1') && !occupied('w2'))) ? 'w2' : 'w1');
  if (selected === 'all') throw new Error('Выберите W1 или W2. Стакан и размер рассчитываются для одного кошелька.');
  const address = selected === 'w1' ? w1Addr : w2Addr;
  let rh, arb;
  try {
    [rh, arb] = await Promise.all([readLighterAccount(address, 'rh'), readLighterAccount(address, 'arb')]);
  } catch {
    throw new Error('Не удалось проверить свободную маржу на обеих площадках Lighter. Расчёт входа недоступен.');
  }
  const marginPerLeg = Math.min(rh.available, arb.available);
  if (!(marginPerLeg > 0 && Number.isFinite(marginPerLeg))) {
    throw new Error('Для расчёта нужна положительная свободная маржа на обеих площадках.');
  }
  const sizing = calculateDynamicNotional(2 * marginPerLeg, 7);
  if (!sizing.notional50Pct) throw new Error('Свободной маржи недостаточно для расчёта двух сценариев.');
  const walletsSummary = [
    `• Кошелёк: *${selected.toUpperCase()}*`,
    `• Свободная маржа: RH *$${rh.available.toFixed(2)}* | Core *$${arb.available.toFixed(2)}*`,
    'Размер каждой ноги ограничен меньшей из двух свободных марж.',
  ].join('\n');

  // 2. Динамический запрос реестра рынков с обеих бирж
  const [rhBooksRes, arbBooksRes] = await Promise.allSettled([
    fetch('https://api.rh.lighter.xyz/api/v1/orderBookDetails', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(7000),
    }).then((r) => r.json() as Promise<{
      order_book_details?: Array<{
        symbol: string;
        market_id: number;
        supported_size_decimals?: number;
        size_decimals?: number;
        min_initial_margin_fraction?: number;
        min_base_amount?: string;
        min_quote_amount?: string;
        status?: string;
        is_frozen?: boolean;
        created_at?: string;
        mark_price?: string;
        last_trade_price?: number;
        open_interest?: number | string;
        market_config?: { force_reduce_only?: boolean };
      }>;
    }>),
    fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(7000),
    }).then((r) => r.json() as Promise<{
      order_book_details?: Array<{
        symbol: string;
        market_id: number;
        supported_size_decimals?: number;
        size_decimals?: number;
        min_initial_margin_fraction?: number;
        min_base_amount?: string;
        min_quote_amount?: string;
        status?: string;
        is_frozen?: boolean;
        created_at?: string;
        mark_price?: string;
        last_trade_price?: number;
        open_interest?: number | string;
        open_interest_usd?: number | string;
        market_config?: { force_reduce_only?: boolean };
      }>;
    }>),
  ]);

  const rhDetails = (rhBooksRes.status === 'fulfilled' && rhBooksRes.value?.order_book_details) || [];
  const arbDetails = (arbBooksRes.status === 'fulfilled' && arbBooksRes.value?.order_book_details) || [];

  const rhMap = new Map(rhDetails.map((b) => [b.symbol.toUpperCase(), b]));
  const arbMap = new Map(arbDetails.map((b) => [b.symbol.toUpperCase(), b]));

  // Определение интервала текущей отчетной недели
  const now = new Date();
  const weekInterval = getReportingWeekInterval(now);

  // Находим пересекающиеся символы
  const candidateSymbols: string[] = [];
  for (const sym of rhMap.keys()) {
    if (arbMap.has(sym)) {
      candidateSymbols.push(sym);
    }
  }

  // 3. Сканирование стаканов и 9-факторная валидация
  const rows: MarketMatrixRow[] = [];

  // Выполняем пачками по 8 запросов для стабильности соединений
  const BATCH_SIZE = 8;
  for (let i = 0; i < candidateSymbols.length; i += BATCH_SIZE) {
    const chunk = candidateSymbols.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (sym) => {
        const rhInfo = rhMap.get(sym)!;
        const arbInfo = arbMap.get(sym)!;

        // Предварительная проверка параметров рынка
        if (
          rhInfo.status !== 'active' ||
          arbInfo.status !== 'active' ||
          rhInfo.is_frozen ||
          arbInfo.is_frozen ||
          rhInfo.market_config?.force_reduce_only ||
          arbInfo.market_config?.force_reduce_only
        ) {
          return;
        }

        const [rhOb, arbOb] = await Promise.all([
          fetchOrderBookOrders('rh', rhInfo.market_id, 50),
          fetchOrderBookOrders('arb', arbInfo.market_id, 50),
        ]);

        const validation = validateMarketHedgeability({
          rhDetail: rhInfo,
          arbDetail: arbInfo,
          rhBidsCount: rhOb.bids.length,
          rhAsksCount: rhOb.asks.length,
          arbBidsCount: arbOb.bids.length,
          arbAsksCount: arbOb.asks.length,
        });

        if (!validation.isHedgeable) {
          return;
        }

        const rhBids = rhOb.bids;
        const rhAsks = rhOb.asks;
        const arbBids = arbOb.bids;
        const arbAsks = arbOb.asks;

        const rhPrice = parseFloat(rhInfo.mark_price || '0') || (typeof rhInfo.last_trade_price === 'number' ? rhInfo.last_trade_price : 0) || 1;
        const arbPrice = parseFloat(arbInfo.mark_price || '0') || (typeof arbInfo.last_trade_price === 'number' ? arbInfo.last_trade_price : 0) || 1;

        const rawRhOi = typeof rhInfo.open_interest === 'number' ? rhInfo.open_interest : parseFloat(rhInfo.open_interest || '0');
        const oiRh = Math.round(rawRhOi * rhPrice * 2);

        const apiArbOiUsd = typeof arbInfo.open_interest_usd === 'number'
          ? arbInfo.open_interest_usd
          : parseFloat(String(arbInfo.open_interest_usd || '0'));
        const rawArbOi = typeof arbInfo.open_interest === 'number' ? arbInfo.open_interest : parseFloat(arbInfo.open_interest || '0');
        const oiArb = apiArbOiUsd > 0 ? Math.round(apiArbOiUsd) : Math.round(rawArbOi * arbPrice * 2);

        // Бусты:
        // А. Квартальный отчет на текущей неделе
        const earnings = getEarningsInfo(sym, now);
        // Б. Новый листинг текущей недели (created_at >= weekStart)
        const isNewListing = checkIsNewListing(rhInfo.created_at, weekInterval.start) || checkIsNewListing(arbInfo.created_at, weekInterval.start);
        const hasBoost = earnings.boost || isNewListing;

        let earningsText = earnings.displayColumn;
        if (isNewListing) {
          earningsText = '🔥 НОВЫЙ ЛИСТИНГ НЕДЕЛИ';
        }

        const isStock = isStockSymbol(sym);
        const assetType = getAssetType(sym);
        const macro = getAssetMacroRisk(sym);

        // Week 13+ Единое протокольное направление (2.5x Hedge Boost):
        // Core LONG + RH SHORT для всех категорий (Crypto, Commodities, Pre-IPOs, Equities).
        // Вход: RH Short (продаем в rhBids), Core Long (покупаем из arbAsks)
        // Выход: Core Long закрытие (продаем в arbBids), RH Short закрытие (откупаем из rhAsks)
        const sellSide = mode === 'open' ? rhBids : arbBids;
        const buySide = mode === 'open' ? arbAsks : rhAsks;

        const wallRhL1 = mode === 'open'
          ? `$${rhBids[0].price} ($${Math.round(rhBids[0].price * rhBids[0].size)})`
          : `$${rhAsks[0].price} ($${Math.round(rhAsks[0].price * rhAsks[0].size)})`;
        const wallRhL2 = mode === 'open'
          ? (rhBids[1] ? `$${rhBids[1].price} ($${Math.round(rhBids[1].price * rhBids[1].size)})` : '—')
          : (rhAsks[1] ? `$${rhAsks[1].price} ($${Math.round(rhAsks[1].price * rhAsks[1].size)})` : '—');

        const wallArbL1 = mode === 'open'
          ? `$${arbAsks[0].price} ($${Math.round(arbAsks[0].price * arbAsks[0].size)})`
          : `$${arbBids[0].price} ($${Math.round(arbBids[0].price * arbBids[0].size)})`;
        const wallArbL2 = mode === 'open'
          ? (arbAsks[1] ? `$${arbAsks[1].price} ($${Math.round(arbAsks[1].price * arbAsks[1].size)})` : '—')
          : (arbBids[1] ? `$${arbBids[1].price} ($${Math.round(arbBids[1].price * arbBids[1].size)})` : '—');

        const rhL1Cash = mode === 'open' ? rhBids[0].price * rhBids[0].size : rhAsks[0].price * rhAsks[0].size;
        const arbL1Cash = mode === 'open' ? arbAsks[0].price * arbAsks[0].size : arbBids[0].price * arbBids[0].size;
        const maxEntryWall = Math.round(Math.min(rhL1Cash, arbL1Cash));

        let edgeSpreadPct = 0.05;
        if (mode === 'open' && arbAsks[0]?.price > 0 && rhBids[0]?.price > 0) {
          edgeSpreadPct = parseFloat((((arbAsks[0].price - rhBids[0].price) / rhBids[0].price) * 100).toFixed(3));
        } else if (rhAsks[0]?.price > 0 && arbBids[0]?.price > 0) {
          edgeSpreadPct = parseFloat((((rhAsks[0].price - arbBids[0].price) / arbBids[0].price) * 100).toFixed(3));
        }

        const sizeDecimals = Math.min(rhInfo.supported_size_decimals ?? rhInfo.size_decimals ?? 8, arbInfo.supported_size_decimals ?? arbInfo.size_decimals ?? 8);
        const walk100 = simulateOrderbookWalk({
          sizeDecimals,
          targetNotional: sizing.notional100Pct,
          sellSideLevels: sellSide,
          buySideLevels: buySide,
        });

        const walk50 = simulateOrderbookWalk({
          sizeDecimals,
          targetNotional: sizing.notional50Pct,
          sellSideLevels: sellSide,
          buySideLevels: buySide,
        });

        const allowedLeverage = Math.max(rhInfo.min_initial_margin_fraction ?? 0, arbInfo.min_initial_margin_fraction ?? 0) * 7 <= 10_000;
        const meetsLimits = (walk: OrderbookWalkResult) => walk.baseQuantity >= Math.max(Number(rhInfo.min_base_amount ?? 0), Number(arbInfo.min_base_amount ?? 0)) &&
          walk.baseQuantity * walk.avgSellPrice >= Number(rhInfo.min_quote_amount ?? 0) &&
          walk.baseQuantity * walk.avgBuyPrice >= Number(arbInfo.min_quote_amount ?? 0);
        const fullDepth = !walk100.exhausted;
        const halfDepth = !walk50.exhausted;
        const availableFull = allowedLeverage && fullDepth && meetsLimits(walk100);
        const availableHalf = allowedLeverage && halfDepth && meetsLimits(walk50);
        const unavailableReason = availableFull ? undefined
          : !allowedLeverage ? 'Плечо 7× выше лимита рынка'
          : !fullDepth ? 'Недостаточно видимой глубины для 100%'
          : 'Полный сценарий ниже минимального размера рынка';
        const verdict = unavailableReason ?? 'Оценка исполнения по доступным заявкам';

        rows.push({
          symbol: sym,
          type: assetType,
          isStock,
          earningsText,
          hasEarningsBoost: hasBoost,
          daysUntilEarnings: earnings.daysUntilEarnings,
          loss100Usd: walk100.lossUsd,
          loss100Pct: walk100.lossPct,
          loss50Usd: walk50.lossUsd,
          loss50Pct: walk50.lossPct,
          oiRobinhoodUsd: oiRh,
          oiArbitrumUsd: oiArb,
          wallRhL1,
          wallRhL2,
          wallArbL1,
          wallArbL2,
          maxEntryWallUsd: maxEntryWall,
          edgeSpreadPct,
          macroRisk: macro,
          verdict,
          isNewListing,
          fullDepth,
          halfDepth,
          availableFull,
          availableHalf,
          unavailableReason,
          fullSize: walk100.baseQuantity,
          halfSize: walk50.baseQuantity,
          observedAt: new Date().toISOString(),
        });
      })
    );
  }

  // 4. Сортировка:
  // Приоритет: 🔥 Бусты (отчет / новый листинг) -> 📈 Акции (по мин loss100Pct и OI) -> 🌐 Другие пары
  const sortedRows = sortMarketMatrixRows(rows);

  if (!sortedRows.length) throw new Error('Нет рынков с доступными стаканами на двух площадках.');
  const fullVolume = sortedRows.filter((row) => row.availableFull !== false).sort((a, b) => a.loss100Pct - b.loss100Pct);
  const halfOnly = sortedRows.filter((row) => row.availableFull === false && row.availableHalf !== false)
    .sort((a, b) => a.loss50Pct - b.loss50Pct);
  const top5 = [...fullVolume, ...halfOnly].slice(0, 5);

  const topCardsText = formatTopCardsMessage({
    walletsSummary,
    sizing,
    topRows: top5,
    mode,
  });

  const fileContent = generateCanonicalJsonFile(sortedRows, { ...sizing, totalEquity: rh.equity + arb.equity }, selected, mode);

  return { topCardsText, fileContent };
}

export async function calculateActiveHedgesExitReport(configOverride?: FullConfig): Promise<{
  text: string;
  inlineKeyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}> {
  const config = configOverride || loadConfig();
  const activeHedges = getActiveHedges(config);

  if (activeHedges.length === 0) {
    return {
      text: '❌ **Нет активных открытых позиций!**\nВсе связки в портфеле закрыты. Чтобы найти лучшие пары для входа, нажмите **📈 Анализ входа (/o)**.',
    };
  }

  const lines = [
    '📉 **АНАЛИЗ ВЫХОДА ИЗ АКТИВНЫХ ПОЗИЦИЙ (/c)**',
    'Оценка по живым стаканам. PnL указан по цене, без уже проведённого funding и комиссий.',
  ];
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const hedge of activeHedges) {
    const symbol = hedge.symbol.toUpperCase();
    const wallet = getHedgeWallet(config, hedge);
    lines.push('', `📌 **${symbol}${wallet ? ' ' + wallet.slot.toUpperCase() : ''}**`);
    if (!wallet || hedge.legs.length !== 2 || hedge.legs.some((leg) => leg.venue !== 'lighter')) {
      lines.push('Для оценки нужны две позиции Lighter одного кошелька.');
      continue;
    }
    buttons.push([{ text: `🛑 Внести выход ${symbol} (${wallet.slot.toUpperCase()})`, callback_data: `close_${symbol}_${wallet.slot}_${hedge.createdAt}` }]);
    try {
      const accounts = await Promise.all([readLighterAccount(wallet.address, 'rh'), readLighterAccount(wallet.address, 'arb')]);
      const positions = accounts.map((account) => account.positions.find((position) => position.symbol === symbol));
      const books = await Promise.all(positions.map((position, index) => position
        ? fetchOrderBookOrders(index === 0 ? 'rh' : 'arb', position.marketIndex)
        : null));
      if (!positions.some(Boolean)) {
        lines.push('Обе позиции уже закрыты на площадках. Для результата по исполненным сделкам нажмите «Внести выход».');
        continue;
      }
      lines.push(...positions.map((position, index) => {
        const venue = index === 0 ? 'RH' : 'Core';
        return position ? `• ${venue} ${position.side.toUpperCase()}: ${position.size} по $${position.entryPrice}` : `• ${venue}: позиция уже закрыта`;
      }));
      for (const fraction of [1, 0.5]) {
        lines.push(fraction === 1 ? '**Полное закрытие (100%)**' : '**Половина позиции (50%)**');
        let total = 0;
        let complete = true;
        const fills: { side: string; quantity: number; average: number }[] = [];
        let slippage = 0;
        for (const [index, position] of positions.entries()) {
          if (!position) continue;
          const levels = position.side === 'long' ? books[index]?.bids : books[index]?.asks;
          const scale = 10 ** (position.sizeDecimals ?? 8);
          const quantity = fraction === 1 ? position.size : Math.floor(position.size * scale / 2 + 1e-8) / scale;
          const quote = fillBookQuantity(levels ?? [], quantity);
          const venue = index === 0 ? 'RH' : 'Core';
          if (!quote || !levels?.[0]) {
            lines.push(`• ${venue}: недостаточно доступной глубины для ${quantity} ${symbol}`);
            complete = false;
            continue;
          }
          const pricePnl = (quote.cash - position.entryPrice * quantity) * (position.side === 'long' ? 1 : -1);
          total += pricePnl;
          slippage += (levels[0].price - quote.average) * quantity * (position.side === 'long' ? 1 : -1);
          fills.push({ side: position.side, quantity, average: quote.average });
          lines.push(`• ${venue}: ${quantity} по средней $${quote.average.toFixed(5)}, PnL $${pricePnl.toFixed(2)}`);
        }
        if (complete) {
          const long = fills.find((fill) => fill.side === 'long');
          const short = fills.find((fill) => fill.side === 'short');
          if (long && short) {
            const spreadCost = (short.average - long.average) * Math.min(short.quantity, long.quantity);
            lines.push(`• Базис выхода (стоимость на общем объёме): $${spreadCost.toFixed(2)}`);
          }
          lines.push(`• Проскальзывание от лучших цен: $${slippage.toFixed(2)}`,
            `• PnL оставшегося объёма по текущим ценам: **$${total.toFixed(2)}**`);
        }
      }
    } catch {
      lines.push('Не удалось подтвердить открытые позиции на обеих площадках. Оценка недоступна.');
    }
  }
  return { text: lines.join('\n'), inlineKeyboard: { inline_keyboard: buttons } };
}
