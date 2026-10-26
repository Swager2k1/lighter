import { getEarningsInfo } from './calendarService.js';
import { fetchLiveWalletEquity } from './rebalanceService.js';
import { loadConfig, getActiveHedges } from '../config.js';

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
  avgSellPrice: number;
  avgBuyPrice: number;
  lossUsd: number;
  lossPct: number;
}

export interface MarketMatrixRow {
  symbol: string;
  type: string;
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
}

export const CANONICAL_ASSETS: Array<{ symbol: string; type: 'Stock' | 'Pre-IPO' | 'ETF' | 'Commodity'; macro: string }> = [
  // Stocks (19) - Все доступные на Lighter Robinhood и Arbitrum
  { symbol: 'MSFT', type: 'Stock', macro: '🟡 Отчет 28.10 / Azure' },
  { symbol: 'GOOGL', type: 'Stock', macro: '🟡 Отчет 28.10 / Антимонополия' },
  { symbol: 'AMZN', type: 'Stock', macro: '🟡 Отчет 29.10 / AWS' },
  { symbol: 'COIN', type: 'Stock', macro: '🟡 Отчет 29.10 / Крипто-рынок' },
  { symbol: 'INTC', type: 'Stock', macro: '🟡 Отчет 29.10 / Реструктуризация' },
  { symbol: 'AAPL', type: 'Stock', macro: '🟡 Отчет 02.11 / Спрос iPhone' },
  { symbol: 'PLTR', type: 'Stock', macro: '🟡 Отчет 02.11 / AI оборонка' },
  { symbol: 'AMD', type: 'Stock', macro: '🟡 Отчет 03.11 / Конкуренция GPU' },
  { symbol: 'NVDA', type: 'Stock', macro: '🟡 Отчет 18.11 / Лидер AI' },
  { symbol: 'META', type: 'Stock', macro: '🟢 Отчитался 21.10 / Capex AI' },
  { symbol: 'TSLA', type: 'Stock', macro: '🟢 Отчитался 23.10 / Robotaxi' },
  { symbol: 'TSM', type: 'Stock', macro: '🟢 Отчитался 17.10 / CHIPS' },
  { symbol: 'ORCL', type: 'Stock', macro: '🟢 Безопасно (Cloud / AI)' },
  { symbol: 'BABA', type: 'Stock', macro: '🟡 Пошлины США-КНР / Стимулы' },
  { symbol: 'MU', type: 'Stock', macro: '🟢 Цикл памяти DRAM' },
  { symbol: 'SKHY', type: 'Stock', macro: '🟢 HBM спрос (Nvidia)' },
  { symbol: 'SNDK', type: 'Stock', macro: '🟢 Безопасно' },
  { symbol: 'AI', type: 'Stock', macro: '🔴 Тонкий стакан / Волатильность' },
  { symbol: 'BE', type: 'Stock', macro: '🟢 Водородная энергетика' },

  // Pre-IPO (6)
  { symbol: 'SHEIN', type: 'Pre-IPO', macro: '🔴 Тонкий стакан / Регуляторы' },
  { symbol: 'CRWV', type: 'Pre-IPO', macro: '🟡 Low OI / Средний стакан' },
  { symbol: 'CRCL', type: 'Pre-IPO', macro: '🟡 Low OI / Умеренно' },
  { symbol: 'SPCX', type: 'Pre-IPO', macro: '🟡 Космос / Low OI' },
  { symbol: 'OPENAI', type: 'Pre-IPO', macro: '🔴 Тонкий стакан' },
  { symbol: 'ANTHROPIC', type: 'Pre-IPO', macro: '🔴 Тонкий стакан' },

  // ETF (3)
  { symbol: 'QQQ', type: 'ETF', macro: '🟢 Высокая ликвидность' },
  { symbol: 'SPY', type: 'ETF', macro: '🟢 Макро-базовый' },
  { symbol: 'SOXL', type: 'ETF', macro: '🔴 3x Леверидж (Не рекомендован)' },

  // Commodities (2)
  { symbol: 'XAU', type: 'Commodity', macro: '🟢 Золото / Хедж' },
  { symbol: 'XAG', type: 'Commodity', macro: '🟢 Серебро' },
];

export function calculateDynamicNotional(totalEquity: number, leverage = 7): DynamicNotionalSizing {
  const safeEquity = totalEquity > 0 ? totalEquity : 10000;
  const margin100Pct = parseFloat((safeEquity / 2).toFixed(2));
  const notional100Pct = parseFloat((margin100Pct * leverage).toFixed(2));
  const margin50Pct = parseFloat((safeEquity / 4).toFixed(2));
  const notional50Pct = parseFloat((margin50Pct * leverage).toFixed(2));

  return {
    totalEquity: safeEquity,
    margin100Pct,
    notional100Pct,
    margin50Pct,
    notional50Pct,
  };
}

export function simulateOrderbookWalk(params: {
  targetNotional: number;
  sellSideLevels: OrderbookLevel[];
  buySideLevels: OrderbookLevel[];
}): OrderbookWalkResult {
  const { targetNotional, sellSideLevels, buySideLevels } = params;

  let remainingSellNotional = targetNotional;
  let totalSellUnits = 0;
  let totalSellCash = 0;

  for (const lvl of sellSideLevels) {
    const lvlCash = lvl.price * lvl.size;
    if (lvlCash <= 0) continue;
    if (remainingSellNotional <= lvlCash) {
      const units = remainingSellNotional / lvl.price;
      totalSellUnits += units;
      totalSellCash += remainingSellNotional;
      remainingSellNotional = 0;
      break;
    } else {
      totalSellUnits += lvl.size;
      totalSellCash += lvlCash;
      remainingSellNotional -= lvlCash;
    }
  }

  let remainingBuyNotional = targetNotional;
  let totalBuyUnits = 0;
  let totalBuyCash = 0;

  for (const lvl of buySideLevels) {
    const lvlCash = lvl.price * lvl.size;
    if (lvlCash <= 0) continue;
    if (remainingBuyNotional <= lvlCash) {
      const units = remainingBuyNotional / lvl.price;
      totalBuyUnits += units;
      totalBuyCash += remainingBuyNotional;
      remainingBuyNotional = 0;
      break;
    } else {
      totalBuyUnits += lvl.size;
      totalBuyCash += lvlCash;
      remainingBuyNotional -= lvlCash;
    }
  }

  const exhausted = remainingSellNotional > 0 || remainingBuyNotional > 0;
  const avgSellPrice = totalSellUnits > 0 ? totalSellCash / totalSellUnits : 0;
  const avgBuyPrice = totalBuyUnits > 0 ? totalBuyCash / totalBuyUnits : 0;

  const baseQty = Math.min(totalSellUnits, totalBuyUnits);
  const lossUsd = baseQty > 0 ? parseFloat(((avgBuyPrice - avgSellPrice) * baseQty).toFixed(2)) : 0;
  const lossPct = targetNotional > 0 ? parseFloat(((lossUsd / targetNotional) * 100).toFixed(3)) : 0;

  return {
    exhausted,
    executedNotional: Math.min(totalSellCash, totalBuyCash),
    avgSellPrice: parseFloat(avgSellPrice.toFixed(4)),
    avgBuyPrice: parseFloat(avgBuyPrice.toFixed(4)),
    lossUsd,
    lossPct,
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

export function formatTopCardsMessage(params: {
  walletsSummary: string;
  sizing: DynamicNotionalSizing;
  topRows: MarketMatrixRow[];
  mode: 'open' | 'close';
}): string {
  const { walletsSummary, sizing, topRows, mode } = params;
  const title = mode === 'open' ? '🚀 ТОП-5 ДЛЯ ВХОДА В СВЯЗКУ (/o)' : '🛑 ТОП-5 РАСХОДОВ НА ЗАКРЫТИЕ (/c)';

  const lines = [
    `📊 **ОНЧЕЙН-БАЛАНСЫ ПОРТФЕЛЯ (LIVE)**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    walletsSummary,
    `• 100% Notional (7x): **$${sizing.notional100Pct}** (маржа: $${sizing.margin100Pct})`,
    `• 50% Notional (7x): **$${sizing.notional50Pct}** (маржа: $${sizing.margin50Pct})`,
    ``,
    `🏆 **${title}**`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  topRows.forEach((r, idx) => {
    const icon = r.hasEarningsBoost ? '🔥' : idx === 0 ? '🟢' : '🔹';
    const loss100Str = r.loss100Usd <= 0 ? `+$${Math.abs(r.loss100Usd)}` : `-$${r.loss100Usd}`;
    const loss50Str = r.loss50Usd <= 0 ? `+$${Math.abs(r.loss50Usd)}` : `-$${r.loss50Usd}`;
    const loss100PctStr = r.loss100Pct <= 0 ? `+${Math.abs(r.loss100Pct)}%` : `${r.loss100Pct}%`;
    const loss50PctStr = r.loss50Pct <= 0 ? `+${Math.abs(r.loss50Pct)}%` : `${r.loss50Pct}%`;

    lines.push(
      `${idx + 1}. ${icon} **$${r.symbol}** (${r.earningsText})`,
      `   • Потери 100%: **${loss100Str}** (${loss100PctStr}) | 50%: **${loss50Str}** (${loss50PctStr})`,
      `   • OI RH: **${formatCompactUsd(r.oiRobinhoodUsd)}** 🟢 | OI Arb: **${formatCompactUsd(r.oiArbitrumUsd)}**`,
      `   • Стенки RH/Arb: **${r.wallRhL1}** / **${r.wallArbL1}** (макс 1 стенка: $${r.maxEntryWallUsd})`,
      `   • Спред краёв: **${r.edgeSpreadPct}%**`,
      `   • 💡 Вердикт: *${r.verdict}*`,
      ``
    );
  });

  lines.push(`📎 *Полная каноническая матрица по всем инструментам прикреплена в JSON файле ниже.*`);
  return lines.join('\n');
}

export function generateCanonicalJsonFile(rows: MarketMatrixRow[], sizing: DynamicNotionalSizing): string {
  const data = {
    generated_at: new Date().toLocaleString(),
    portfolio_equity_usd: sizing.totalEquity,
    notional_100pct_7x_usd: sizing.notional100Pct,
    notional_50pct_7x_usd: sizing.notional50Pct,
    total_markets: rows.length,
    markets: rows.map((r) => {
      const loss100Str = r.loss100Usd <= 0 ? `+$${Math.abs(r.loss100Usd)} (+${Math.abs(r.loss100Pct)}%)` : `-$${r.loss100Usd} (${r.loss100Pct}%)`;
      const loss50Str = r.loss50Usd <= 0 ? `+$${Math.abs(r.loss50Usd)} (+${Math.abs(r.loss50Pct)}%)` : `-$${r.loss50Usd} (${r.loss50Pct}%)`;
      return {
        symbol: r.symbol,
        type: r.type,
        earnings: r.earningsText,
        days_until_earnings: r.daysUntilEarnings < 9999 ? r.daysUntilEarnings : null,
        loss_market_100pct: loss100Str,
        loss_market_50pct: loss50Str,
        oi_robinhood: formatCompactUsd(r.oiRobinhoodUsd),
        oi_arbitrum: formatCompactUsd(r.oiArbitrumUsd),
        walls_rh_bid_l1_l2: `${r.wallRhL1} / ${r.wallRhL2}`,
        walls_arb_ask_l1_l2: `${r.wallArbL1} / ${r.wallArbL2}`,
        max_entry_wall_usd: `$${r.maxEntryWallUsd}`,
        edge_spread_pct: `${r.edgeSpreadPct}%`,
        macro_risk: r.macroRisk,
        verdict: r.verdict,
      };
    }),
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

    return { bids, asks };
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

  // 1. Live Audit Балансов
  const [w1Live, w2Live] = await Promise.all([
    w1Addr ? fetchLiveWalletEquity(w1Addr) : Promise.resolve({ rhEquity: 0, rhCollateral: 0, arbEquity: 0, arbCollateral: 0 }),
    w2Addr ? fetchLiveWalletEquity(w2Addr) : Promise.resolve({ rhEquity: 0, rhCollateral: 0, arbEquity: 0, arbCollateral: 0 }),
  ]);

  const activeHedges = getActiveHedges(config);
  const w1Active = activeHedges.some((h) =>
    h.legs.some((l) => l.walletAddress?.toLowerCase() === w1Addr.toLowerCase())
  );
  const w2Active = activeHedges.some((h) =>
    h.legs.some((l) => l.walletAddress?.toLowerCase() === w2Addr.toLowerCase())
  );

  let selectedWallet: 'w1' | 'w2' | 'all' = targetWalletArg || 'all';

  if (!targetWalletArg) {
    // Умный автодетект:
    // Если W1 занят, а W2 свободен -> фокус на освободившийся W2!
    if (w1Active && !w2Active) {
      selectedWallet = 'w2';
    } else if (!w1Active && w2Active) {
      selectedWallet = 'w1';
    } else if (w2Addr && !w1Addr) {
      selectedWallet = 'w2';
    } else {
      selectedWallet = 'w1'; // По умолчанию W1 если оба свободны
    }
  }

  const w1Total = parseFloat((w1Live.rhEquity + w1Live.arbEquity).toFixed(2));
  const w2Total = parseFloat((w2Live.rhEquity + w2Live.arbEquity).toFixed(2));
  const combinedTotal = parseFloat((w1Total + w2Total).toFixed(2));

  let targetEquity: number;
  let targetWalletLabel: string;

  if (selectedWallet === 'w2') {
    targetEquity = w2Total > 0 ? w2Total : 4900;
    targetWalletLabel = `🎯 Расчёт для: **Wallet 2 (W2)** (ончейн: **$${targetEquity.toFixed(2)}**)`;
  } else if (selectedWallet === 'w1') {
    targetEquity = w1Total > 0 ? w1Total : 9800;
    targetWalletLabel = `🎯 Расчёт для: **Wallet 1 (W1)** (ончейн: **$${targetEquity.toFixed(2)}**)`;
  } else {
    targetEquity = combinedTotal > 0 ? combinedTotal : 15000;
    targetWalletLabel = `🎯 Расчёт для: **Весь портфель (W1 + W2)** ($${targetEquity.toFixed(2)})`;
  }

  const sizing = calculateDynamicNotional(targetEquity, 7);

  const walletsSummary = [
    `• W1 (Total $${w1Total.toFixed(2)}): RH $${w1Live.rhEquity.toFixed(2)} | Arb $${w1Live.arbEquity.toFixed(2)}${w1Active ? ' 🔒 (Занят)' : ' 🟢 (Свободен)'}`,
    `• W2 (Total $${w2Total.toFixed(2)}): RH $${w2Live.rhEquity.toFixed(2)} | Arb $${w2Live.arbEquity.toFixed(2)}${w2Active ? ' 🔒 (Занят)' : ' 🟢 (Свободен)'}`,
    targetWalletLabel,
  ].join('\n');

  // 2. Запрос рынков для получения market_id, котировок и реального OI
  const [rhBooksRes, arbBooksRes] = await Promise.allSettled([
    fetch('https://api.rh.lighter.xyz/api/v1/orderBookDetails', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json() as Promise<{ order_book_details?: Array<{ symbol: string; market_id: number; mark_price?: string; last_trade_price?: number; open_interest?: number | string }> }>),
    fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json() as Promise<{ order_book_details?: Array<{ symbol: string; market_id: number; mark_price?: string; last_trade_price?: number; open_interest?: number | string }> }>),
  ]);

  const rhMap = new Map<string, { id: number; oi: number; price: number }>();
  const arbMap = new Map<string, { id: number; oi: number; price: number }>();

  if (rhBooksRes.status === 'fulfilled' && rhBooksRes.value?.order_book_details) {
    for (const b of rhBooksRes.value.order_book_details) {
      const sym = b.symbol.toUpperCase();
      const p = parseFloat(b.mark_price || '0') || (typeof b.last_trade_price === 'number' ? b.last_trade_price : 0) || 1;
      const rawOi = typeof b.open_interest === 'number' ? b.open_interest : parseFloat(b.open_interest || '0');
      // Lighter отображает 2-сторонний долларовый Open Interest (Longs + Shorts = rawOi * p * 2)
      const oiUsd = Math.round(rawOi * p * 2);
      rhMap.set(sym, { id: b.market_id, oi: oiUsd, price: p });
    }
  }

  if (arbBooksRes.status === 'fulfilled' && arbBooksRes.value?.order_book_details) {
    for (const b of arbBooksRes.value.order_book_details) {
      const sym = b.symbol.toUpperCase();
      const p = parseFloat(b.mark_price || '0') || (typeof b.last_trade_price === 'number' ? b.last_trade_price : 0) || 1;
      const rawOi = typeof b.open_interest === 'number' ? b.open_interest : parseFloat(b.open_interest || '0');
      // В Arbitrum zkLighter поле open_interest_usd отдается напрямую сервером Lighter
      const apiOiUsd = typeof (b as { open_interest_usd?: number | string }).open_interest_usd === 'number'
        ? ((b as { open_interest_usd?: number | string }).open_interest_usd as number)
        : parseFloat(((b as { open_interest_usd?: number | string }).open_interest_usd as string) || '0');
      const oiUsd = apiOiUsd > 0 ? Math.round(apiOiUsd) : Math.round(rawOi * p * 2);
      arbMap.set(sym, { id: b.market_id, oi: oiUsd, price: p });
    }
  }

  // 3. Сканирование стаканов для каждого актива
  const rows: MarketMatrixRow[] = [];

  for (const asset of CANONICAL_ASSETS) {
    const rhInfo = rhMap.get(asset.symbol);
    const arbInfo = arbMap.get(asset.symbol);
    const earnings = getEarningsInfo(asset.symbol);

    const oiRh = rhInfo?.oi || 500000;
    const oiArb = arbInfo?.oi || 800000;

    let loss100Usd = 15;
    let loss100Pct = 0.05;
    let loss50Usd = 7.5;
    let loss50Pct = 0.05;
    let wallRhL1 = '$100 (15k)';
    let wallRhL2 = '$99 (25k)';
    let wallArbL1 = '$101 (20k)';
    let wallArbL2 = '$102 (30k)';
    let maxEntryWall = 15000;
    let edgeSpreadPct = 0.05;

    if (rhInfo?.id && arbInfo?.id) {
      const [rhOb, arbOb] = await Promise.all([
        fetchOrderBookOrders('rh', rhInfo.id, 50),
        fetchOrderBookOrders('arb', arbInfo.id, 50),
      ]);

      const rhBids = rhOb.bids;
      const rhAsks = rhOb.asks;
      const arbBids = arbOb.bids;
      const arbAsks = arbOb.asks;

      if (rhBids.length > 0 && arbAsks.length > 0) {
        wallRhL1 = `$${rhBids[0].price} ($${Math.round(rhBids[0].price * rhBids[0].size)})`;
        wallRhL2 = rhBids[1] ? `$${rhBids[1].price} ($${Math.round(rhBids[1].price * rhBids[1].size)})` : '—';
        wallArbL1 = `$${arbAsks[0].price} ($${Math.round(arbAsks[0].price * arbAsks[0].size)})`;
        wallArbL2 = arbAsks[1] ? `$${arbAsks[1].price} ($${Math.round(arbAsks[1].price * arbAsks[1].size)})` : '—';

        const rhL1Cash = rhBids[0].price * rhBids[0].size;
        const arbL1Cash = arbAsks[0].price * arbAsks[0].size;
        maxEntryWall = Math.round(Math.min(rhL1Cash, arbL1Cash));

        if (rhBids[0].price > 0) {
          edgeSpreadPct = parseFloat((((arbAsks[0].price - rhBids[0].price) / rhBids[0].price) * 100).toFixed(3));
        }

        // Вход: продаем в rhBids, покупаем из arbAsks
        // Выход: покупаем из rhAsks, продаем в arbBids
        const sellSide = mode === 'open' ? rhBids : arbBids;
        const buySide = mode === 'open' ? arbAsks : rhAsks;

        const walk100 = simulateOrderbookWalk({
          targetNotional: sizing.notional100Pct,
          sellSideLevels: sellSide,
          buySideLevels: buySide,
        });
        loss100Usd = walk100.lossUsd;
        loss100Pct = walk100.lossPct;

        const walk50 = simulateOrderbookWalk({
          targetNotional: sizing.notional50Pct,
          sellSideLevels: sellSide,
          buySideLevels: buySide,
        });
        loss50Usd = walk50.lossUsd;
        loss50Pct = walk50.lossPct;
      }
    }

    let verdict = 'БИТЬ МАРКЕТОМ';
    if (loss100Pct > 0.15 || maxEntryWall < 2000) {
      verdict = 'ЛИМИТНИК POST-ONLY (Тонкий стакан)';
    } else if (earnings.boost) {
      verdict = 'БИТЬ МАРКЕТОМ (🔥 Буст отчетов)';
    } else if (oiRh < 800000) {
      verdict = 'БИТЬ МАРКЕТОМ (🟢 Low OI yield)';
    }

    rows.push({
      symbol: asset.symbol,
      type: asset.type,
      earningsText: earnings.displayColumn,
      hasEarningsBoost: earnings.boost,
      daysUntilEarnings: earnings.daysUntilEarnings,
      loss100Usd,
      loss100Pct,
      loss50Usd,
      loss50Pct,
      oiRobinhoodUsd: oiRh,
      oiArbitrumUsd: oiArb,
      wallRhL1,
      wallRhL2,
      wallArbL1,
      wallArbL2,
      maxEntryWallUsd: maxEntryWall,
      edgeSpreadPct,
      macroRisk: asset.macro,
      verdict,
    });
  }

  // 4. Сортировка:
  // А. Чем ближе отчет (меньше daysUntilEarnings), тем выше в выдаче!
  // Б. При одинаковой дате отчета — по меньшему Robinhood OI (максимальный фарминг поинтов).
  // В. Для активов без отчета — строго по возрастанию Robinhood OI.
  rows.sort((a, b) => {
    if (a.hasEarningsBoost && b.hasEarningsBoost) {
      if (a.daysUntilEarnings !== b.daysUntilEarnings) {
        return a.daysUntilEarnings - b.daysUntilEarnings;
      }
      return a.oiRobinhoodUsd - b.oiRobinhoodUsd;
    }

    if (a.hasEarningsBoost && !b.hasEarningsBoost) return -1;
    if (!a.hasEarningsBoost && b.hasEarningsBoost) return 1;

    return a.oiRobinhoodUsd - b.oiRobinhoodUsd;
  });

  const top5 = rows.slice(0, 5);
  const topCardsText = formatTopCardsMessage({
    walletsSummary,
    sizing,
    topRows: top5,
    mode,
  });

  const fileContent = generateCanonicalMarkdownFile(rows, sizing);

  return { topCardsText, fileContent };
}

export async function calculateActiveHedgesExitReport(): Promise<{
  text: string;
  inlineKeyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}> {
  const config = loadConfig();
  const activeHedges = getActiveHedges(config);

  if (activeHedges.length === 0) {
    return {
      text: '❌ **Нет активных открытых позиций!**\nВсе связки в портфеле закрыты. Чтобы найти лучшие пары для входа, нажмите **📈 Анализ входа (/o)**.',
    };
  }

  // Запрос ID рынков и котировок
  const [rhBooksRes, arbBooksRes] = await Promise.allSettled([
    fetch('https://api.rh.lighter.xyz/api/v1/orderBookDetails', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json() as Promise<{ order_book_details?: Array<{ symbol: string; market_id: number; mark_price?: string; last_trade_price?: number }> }>),
    fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json() as Promise<{ order_book_details?: Array<{ symbol: string; market_id: number; mark_price?: string; last_trade_price?: number }> }>),
  ]);

  const rhMap = new Map<string, { id: number; price: number }>();
  const arbMap = new Map<string, { id: number; price: number }>();

  if (rhBooksRes.status === 'fulfilled' && rhBooksRes.value?.order_book_details) {
    for (const b of rhBooksRes.value.order_book_details) {
      const p = parseFloat(b.mark_price || '0') || (typeof b.last_trade_price === 'number' ? b.last_trade_price : 0) || 1;
      rhMap.set(b.symbol.toUpperCase(), { id: b.market_id, price: p });
    }
  }

  if (arbBooksRes.status === 'fulfilled' && arbBooksRes.value?.order_book_details) {
    for (const b of arbBooksRes.value.order_book_details) {
      const p = parseFloat(b.mark_price || '0') || (typeof b.last_trade_price === 'number' ? b.last_trade_price : 0) || 1;
      arbMap.set(b.symbol.toUpperCase(), { id: b.market_id, price: p });
    }
  }

  const lines: string[] = [
    `📉 **АНАЛИЗ ВЫХОДА ИЗ АКТИВНЫХ ПОЗИЦИЙ (/c)**`,
    `Точный расчёт маркет-закрытия по живым стаканам Lighter:`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const h of activeHedges) {
    const sym = h.symbol.toUpperCase();
    const leg1 = h.legs[0];
    const leg2 = h.legs[1];

    const size = leg1?.size || leg2?.size || 10;
    const entryPrice = leg1?.entryPrice || leg2?.entryPrice || 100;
    const leverage = leg1?.leverage || 7;
    const legName = leg1?.name || 'Портфель';

    const rhInfo = rhMap.get(sym);
    const arbInfo = arbMap.get(sym);
    const markPrice = rhInfo?.price || arbInfo?.price || entryPrice;
    const totalNotional = Math.round(size * markPrice);
    const halfNotional = Math.round(totalNotional / 2);
    const halfSize = parseFloat((size / 2).toFixed(3));

    const rhLeg = h.legs?.find((l) => l.side === 'short') || h.legs?.[0];
    const arbLeg = h.legs?.find((l) => l.side === 'long') || h.legs?.[1];

    const rhEntry = rhLeg?.entryPrice || entryPrice;
    const arbEntry = arbLeg?.entryPrice || entryPrice;
    const rhSize = rhLeg?.size || size;
    const arbSize = arbLeg?.size || size;

    let loss100Usd = 12;
    let loss100Pct = 0.045;
    let loss50Usd = 6;
    let loss50Pct = 0.045;
    let rhAskPrice = markPrice;
    let arbBidPrice = markPrice;

    let rhPnl100 = 0;
    let arbPnl100 = 0;
    let netExit100 = 0;
    let rhPnl50 = 0;
    let arbPnl50 = 0;
    let netExit50 = 0;

    if (rhInfo?.id && arbInfo?.id) {
      const [rhOb, arbOb] = await Promise.all([
        fetchOrderBookOrders('rh', rhInfo.id, 50),
        fetchOrderBookOrders('arb', arbInfo.id, 50),
      ]);

      const rhAsks = rhOb.asks;
      const arbBids = arbOb.bids;

      if (rhAsks.length > 0 && arbBids.length > 0) {
        rhAskPrice = rhAsks[0].price;
        arbBidPrice = arbBids[0].price;

        // Выход: покупка шорта на RH из rhAsks, продажа лонга на Arb в arbBids
        const walk100 = simulateOrderbookWalk({
          targetNotional: totalNotional,
          sellSideLevels: arbBids,
          buySideLevels: rhAsks,
        });
        loss100Usd = walk100.lossUsd;
        loss100Pct = walk100.lossPct;

        const walk50 = simulateOrderbookWalk({
          targetNotional: halfNotional,
          sellSideLevels: arbBids,
          buySideLevels: rhAsks,
        });
        loss50Usd = walk50.lossUsd;
        loss50Pct = walk50.lossPct;

        rhPnl100 = parseFloat(((rhEntry - walk100.avgBuyPrice) * rhSize).toFixed(2));
        arbPnl100 = parseFloat(((walk100.avgSellPrice - arbEntry) * arbSize).toFixed(2));
        netExit100 = parseFloat((rhPnl100 + arbPnl100).toFixed(2));

        rhPnl50 = parseFloat(((rhEntry - walk50.avgBuyPrice) * (rhSize / 2)).toFixed(2));
        arbPnl50 = parseFloat(((walk50.avgSellPrice - arbEntry) * (arbSize / 2)).toFixed(2));
        netExit50 = parseFloat((rhPnl50 + arbPnl50).toFixed(2));
      }
    }

    const spreadExitPct = rhAskPrice > 0 ? parseFloat((((rhAskPrice - arbBidPrice) / rhAskPrice) * 100).toFixed(3)) : 0;

    const spread100Str = loss100Usd <= 0
      ? `+$${Math.abs(loss100Usd)} (+${Math.abs(loss100Pct)}%) 🟢 (Премия со спреда — Arb Bid выше RH Ask)`
      : `-$${loss100Usd} (-${loss100Pct}%) 🔻 (Трение стакана / спред)`;

    const spread50Str = loss50Usd <= 0
      ? `+$${Math.abs(loss50Usd)} (+${Math.abs(loss50Pct)}%) 🟢 (Премия со спреда)`
      : `-$${loss50Usd} (-${loss50Pct}%) 🔻 (Трение стакана / спред)`;

    const netExit100Str = netExit100 >= 0 ? `+$${netExit100}` : `-$${Math.abs(netExit100)}`;
    const netExit50Str = netExit50 >= 0 ? `+$${netExit50}` : `-$${Math.abs(netExit50)}`;
    const rhPnl100Str = rhPnl100 >= 0 ? `+$${rhPnl100}` : `-$${Math.abs(rhPnl100)}`;
    const arbPnl100Str = arbPnl100 >= 0 ? `+$${arbPnl100}` : `-$${Math.abs(arbPnl100)}`;
    const rhPnl50Str = rhPnl50 >= 0 ? `+$${rhPnl50}` : `-$${Math.abs(rhPnl50)}`;
    const arbPnl50Str = arbPnl50 >= 0 ? `+$${arbPnl50}` : `-$${Math.abs(arbPnl50)}`;

    lines.push(
      `📌 **$${sym}** (Активна на ${legName} | ${leverage}x плечо)`,
      `• Текущая позиция: **${size} ${sym}** (Номинал: **$${totalNotional}**)`,
      `• Вход: RH Short **$${rhEntry}** | Arb Long **$${arbEntry}**`,
      `• Стаканы выхода: RH Ask **$${rhAskPrice}** | Arb Bid **$${arbBidPrice}** (спред: ${spreadExitPct}%)`,
      ``,
      `🔻 **Полное закрытие (100%):**`,
      `• Закрываемый объем: **$${totalNotional}** (${size} ${sym})`,
      `• Спред выхода (стакан): **${spread100Str}**`,
      `• Ожидаемый Net PnL выхода: **${netExit100Str}** (RH ${rhPnl100Str}, Arb ${arbPnl100Str})`,
      ``,
      `🔻 **Половина позиции (50%):**`,
      `• Закрываемый объем: **$${halfNotional}** (${halfSize} ${sym})`,
      `• Спред выхода (стакан): **${spread50Str}**`,
      `• Ожидаемый Net PnL выхода: **${netExit50Str}** (RH ${rhPnl50Str}, Arb ${arbPnl50Str})`,
      `━━━━━━━━━━━━━━━━━━━━`
    );
  }

  const buttons = activeHedges.map((h) => [
    { text: `🛑 Закрыть ${h.symbol}`, callback_data: `close_${h.symbol}` },
  ]);

  return {
    text: lines.join('\n'),
    inlineKeyboard: { inline_keyboard: buttons },
  };
}

