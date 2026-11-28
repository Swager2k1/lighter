import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveHedgeConfig, deactivateHedge, findHedge, getActiveHedges, confirmConfigSave, type FullConfig } from '../config.js';
import { readLighterAccount } from '../connectors/lighter.js';
import { estimateCycleFunding, readClosedCycle } from './lighterExecutions.js';
import { githubSyncService } from './githubSyncService.js';
import { ThreeLegHedge } from '../types.js';

export interface EntryFrictionParams {
  rhShortPrice?: number;
  arbLongPrice?: number;
  buyPrice?: number;
  sellPrice?: number;
  size: number;
  notional: number;
}

export function getCurrentTradingWeek(at = new Date()): { week: string; period: string } {
  const weekMs = 7 * 86_400_000;
  const anchor = Date.UTC(2026, 10, 13);
  const offset = Math.floor((at.getTime() - anchor) / weekMs);
  const format = (time: number) => new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit',
  }).format(time);
  const start = anchor + offset * weekMs;
  return { week: `Week ${10 + offset}`, period: `${format(start)} - ${format(start + weekMs)}` };
}

type Slot = 'w1' | 'w2';

function walletAddress(config: FullConfig, slot: Slot) {
  return (slot === 'w1' ? config.wallets.robinhoodWallet1 : config.wallets.robinhoodWallet2)?.trim();
}

export function getHedgeWallet(config: FullConfig, hedge: ThreeLegHedge): { slot: Slot; address: string } | null {
  const addresses = new Set(hedge.legs.map((leg) => leg.walletAddress?.trim().toLowerCase()).filter(Boolean));
  const slot = hedge.walletSlot ?? (['w1', 'w2'] as const).find((candidate) => {
    const address = walletAddress(config, candidate);
    return address && addresses.has(address.toLowerCase());
  });
  if (!slot) return null;
  const address = walletAddress(config, slot);
  if (!address || addresses.size > 1 || (addresses.size === 1 && !addresses.has(address.toLowerCase()))) return null;
  return { slot, address };
}

export interface MarginLeverageParams {
  size: number;
  entryPrice: number;
  allocatedMargin?: number;
  /** IMF as percent from Lighter API, e.g. 14.29 → ~7x */
  initialMarginFraction?: number;
  accountCollateral?: number;
  fallbackLeverage?: number;
}

/**
 * Safe margin/leverage from onchain signals.
 * Rejects absurd leverage from tiny leftover collateral (the ORCL 422x bug).
 */
export function computeMarginAndLeverage(params: MarginLeverageParams): { margin: number; leverage: number } {
  const notional = params.size * params.entryPrice;
  const fallbackLev = params.fallbackLeverage && params.fallbackLeverage > 0 ? params.fallbackLeverage : 7;

  if (params.allocatedMargin && params.allocatedMargin > 0 && notional > 0) {
    const margin = parseFloat(params.allocatedMargin.toFixed(2));
    const leverage = parseFloat((notional / margin).toFixed(2));
    if (leverage >= 1 && leverage <= 20) {
      return { margin, leverage };
    }
  }

  if (params.initialMarginFraction && params.initialMarginFraction > 0 && notional > 0) {
    const imfPct = params.initialMarginFraction;
    // API may send 14.29 (%) or rarely a fraction < 1
    const leverage = parseFloat((imfPct < 1 ? 1 / imfPct : 100 / imfPct).toFixed(2));
    const margin = parseFloat((notional / leverage).toFixed(2));
    if (leverage >= 1 && leverage <= 20) {
      return { margin, leverage };
    }
  }

  if (params.accountCollateral && params.accountCollateral > 0 && notional > 0) {
    const margin = parseFloat(params.accountCollateral.toFixed(2));
    const leverage = parseFloat((notional / margin).toFixed(2));
    // Guard: ignore leftover dust collateral that implies insane leverage
    if (leverage >= 1 && leverage <= 20) {
      return { margin, leverage };
    }
  }

  const leverage = fallbackLev;
  const margin = Math.round(notional / leverage);
  return { margin, leverage };
}

export function calculateEntryFriction(params: EntryFrictionParams): { frictionUsd: number; frictionPct: number } {
  const { size, notional } = params;
  let buyPrice = params.buyPrice;
  let sellPrice = params.sellPrice;

  // Если переданы legacy rhShortPrice / arbLongPrice
  if (buyPrice === undefined || sellPrice === undefined) {
    buyPrice = params.arbLongPrice ?? 0;
    sellPrice = params.rhShortPrice ?? 0;
  }

  // Трение (потеря на спреде): если купили дороже, чем продали, friction > 0 (расход)
  // Если продали дороже, чем купили, friction <= 0 (премия в пользу трейдера)
  const spread = (buyPrice - sellPrice) * size;
  const frictionPct = notional > 0 ? Number((spread / notional * 100).toFixed(3)) : 0;
  return { frictionUsd: Number(spread.toFixed(2)), frictionPct };
}

export function formatCsvEntryRow(params: {
  week: string;
  period: string;
  asset: string;
  venue: string;
  legDescription: string;
  side: string;
  entryPrice: number;
  size: number;
  margin: number;
  frictionUsd: number;
  notes?: string;
}): string {
  // frictionUsd > 0 -> потеря (спред расход), пишем -frictionUsd
  // frictionUsd <= 0 -> премия (базис профит), пишем +|frictionUsd|
  const balanceChangeStr = params.frictionUsd <= 0
    ? `+${Math.abs(params.frictionUsd)}`
    : `-${params.frictionUsd}`;
  const noteStr = (params.notes || `Opened via /o ${params.asset} (Entry basis: ${balanceChangeStr})`).replaceAll('"', '""');
  return `${params.week},${params.period},${params.asset},${params.venue},${params.legDescription},${params.side},${params.entryPrice},-,${params.size},${params.margin},${params.margin},-,-,-,0,-,-,"${noteStr}"`;
}

export function formatCsvExitRow(params: {
  week: string;
  period: string;
  asset: string;
  venue: string;
  legDescription: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  margin: number;
  netPnl: number;
  netBalanceChange: number | null;
  notes?: string;
}): string {
  const noteStr = (params.notes || `Closed via /c ${params.asset}`).replaceAll('"', '""');
  const balance = params.netBalanceChange === null ? '-' : String(params.netBalanceChange);
  return `${params.week},${params.period},${params.asset},${params.venue},${params.legDescription},${params.side},${params.entryPrice},${params.exitPrice},${params.size},${params.margin},${params.margin},-,${params.netPnl > 0 ? '+' : ''}${params.netPnl},${balance},0,-,-,"${noteStr}"`;
}

export function appendRowToCsv(csvRow: string, marker?: string): Promise<boolean> {
  const csvPath = path.resolve(process.cwd(), 'pnl_and_points_analysis.csv');
  try {
    const content = fs.readFileSync(csvPath, 'utf8');
    if (!marker || !content.includes(marker)) fs.appendFileSync(csvPath, `\n${csvRow}`);
    const sync = githubSyncService.syncCsvFile(fs.readFileSync(csvPath, 'utf8'), 'sync: log trade row [skip ci]');
    return sync.then((result) => result.success || result.reason === 'missing_token').catch(() => false);
  } catch (err) {
    console.error('[PositionSync] Ошибка записи CSV:', err);
    return Promise.resolve(false);
  }
}

export function parseOpenCommandArgs(args: string[]): {
  symbol?: string;
  targetWallet?: 'w1' | 'w2';
  manualSize?: number;
  manualPrice?: number;
  manualLeverage?: number;
} {
  if (!args || args.length === 0) return {};

  const symbol = args[0]?.toUpperCase().replace('-USD', '').replace('-PERP', '');
  let targetWallet: 'w1' | 'w2' | undefined;
  let manualSize: number | undefined;
  let manualPrice: number | undefined;
  let manualLeverage: number | undefined;

  const remaining = args.slice(1);
  for (const token of remaining) {
    const lower = token.toLowerCase();
    if (lower === 'w1' || lower === 'w2') {
      targetWallet = lower;
    } else if (/^(\d+(\.\d+)?)x$/i.test(token)) {
      const match = token.match(/^(\d+(\.\d+)?)x$/i);
      if (match) {
        manualLeverage = parseFloat(match[1]);
      }
    } else {
      const num = parseFloat(token);
      if (!isNaN(num) && num > 0) {
        if (manualSize === undefined) {
          manualSize = num;
        } else if (manualPrice === undefined) {
          manualPrice = num;
        } else if (manualLeverage === undefined) {
          manualLeverage = num;
        }
      }
    }
  }

  return { symbol, targetWallet, manualSize, manualPrice, manualLeverage };
}

export function parseCloseCommandArgs(args: string[]): {
  symbol?: string;
  targetWallet?: 'w1' | 'w2';
  exitPrice?: number;
} {
  if (!args || args.length === 0) return {};
  const symbol = args[0]?.toUpperCase().replace('-USD', '').replace('-PERP', '');
  let targetWallet: 'w1' | 'w2' | undefined;
  let exitPrice: number | undefined;

  const remaining = args.slice(1);
  for (const token of remaining) {
    const lower = token.toLowerCase();
    if (lower === 'w1' || lower === 'w2') {
      targetWallet = lower;
    } else {
      const num = parseFloat(token);
      if (!isNaN(num) && num > 0) {
        exitPrice = num;
      }
    }
  }
  return { symbol, targetWallet, exitPrice };
}

const venues = ['rh', 'arb'] as const;
const venueLabels = ['RH', 'Core'] as const;
type Accounts = Awaited<ReturnType<typeof readAccounts>>;
function readAccounts(address: string) {
  return Promise.all(venues.map((venue) => readLighterAccount(address, venue)));
}

export async function readMonitoredWallets(config: FullConfig) {
  return new Map(await Promise.all((['w1', 'w2'] as const).map(async (slot) => {
    const address = walletAddress(config, slot);
    const accounts = address ? await Promise.allSettled(venues.map((venue) => readLighterAccount(address, venue))) : [];
    return [slot, accounts] as const;
  })));
}

export function refreshMonitoredHedge(config: FullConfig, tracked: ThreeLegHedge, wallets: Awaited<ReturnType<typeof readMonitoredWallets>>) {
  const wallet = getHedgeWallet(config, tracked);
  const accounts = wallet ? wallets.get(wallet.slot) : undefined;
  const hedge = { ...tracked, legs: tracked.legs.flatMap((leg) => {
    if (leg.venue !== 'lighter') return [leg];
    const index = leg.id.startsWith('core_') ? 1 : leg.id.startsWith('rh_') ? 0 : -1;
    const result = accounts?.[index];
    if (!result || result.status !== 'fulfilled') return [leg];
    const position = result.value.positions.find((open) => open.symbol === tracked.symbol.toUpperCase());
    if (!position) return [];
    return [{ ...leg, side: position.side, size: position.size, entryPrice: position.entryPrice,
      liquidationPrice: position.liquidationPrice || leg.liquidationPrice }];
  }) };
  return hedge;
}

function livePositions(accounts: Accounts, symbol: string) {
  return accounts.map((account) => account.positions.find((position) => position.symbol === symbol));
}

export async function activateHedgeOnchain(
  symbol: string, targetWallet?: Slot, _manualSize?: number, _manualPrice?: number, _manualLeverage?: number,
): Promise<string> {
  const config = loadConfig();
  const norm = symbol.toUpperCase().replace(/-(USD|PERP)$/, '');
  const candidates = targetWallet ? [targetWallet] : (['w1', 'w2'] as const).filter((slot) => walletAddress(config, slot));
  try {
    const wallets = await Promise.all(candidates.map(async (slot) => {
      const address = walletAddress(config, slot);
      if (!address) throw new Error('Wallet missing');
      const accounts = await readAccounts(address);
      return { slot, address, positions: livePositions(accounts, norm) };
    }));
    const matches = wallets.filter((wallet) => wallet.positions.some(Boolean));
    if (matches.length !== 1) return matches.length
      ? `⚠️ ${norm} найден на двух кошельках. Укажите W1 или W2.`
      : `⚠️ На проверенных кошельках нет открытых позиций ${norm}.`;
    const { slot, address, positions } = matches[0];
    const [rh, core] = positions;
    if (!rh || !core || rh.side === core.side) {
      return `⚠️ ${norm} ${slot.toUpperCase()}: для записи входа нужны две подтверждённые разнонаправленные ноги. Состояние мониторинга сохранено.`;
    }

    const freshConfig = loadConfig();
    const existing = getActiveHedges(freshConfig).find((hedge) => hedge.symbol.toUpperCase() === norm &&
      getHedgeWallet(freshConfig, hedge)?.slot === slot) ?? findHedge(freshConfig, norm, slot);
    const now = Date.now();
    const legs = [rh, core].map((position, index) => {
      const { size, entryPrice, side } = position;
      const { margin, leverage } = computeMarginAndLeverage(position);
      return {
        id: `${index === 0 ? 'rh' : 'core'}_${norm.toLowerCase()}_${slot}_${side}`,
        name: `${venueLabels[index]} ${slot.toUpperCase()} (${side === 'long' ? 'Long' : 'Short'})`,
        venue: 'lighter' as const, size, entryPrice, side, margin, leverage,
        liquidationPrice: position.liquidationPrice || undefined,
        walletAddress: address,
      };
    });
    const hedge: ThreeLegHedge = {
      id: existing?.id ?? `${norm}_${slot.toUpperCase()}`, symbol: norm, walletSlot: slot, active: true, legs,
      createdAt: existing?.active ? existing.createdAt : now, updatedAt: now,
      entryJournalMarker: existing?.active ? existing.entryJournalMarker : `[open:${slot}:${norm}:${now}]`,
    };
    const buy = rh.side === 'long' ? rh : core;
    const sell = rh.side === 'short' ? rh : core;
    const matched = Math.min(rh.size, core.size);
    const basis = calculateEntryFriction({ buyPrice: buy.entryPrice, sellPrice: sell.entryPrice, size: matched, notional: sell.entryPrice * matched });
    const basisSource = rh.entryPriceRounded || core.entryPriceRounded
      ? 'Оценка спреда по округлённым ценам позиции' : 'Спред по стоимости открытых позиций Lighter';
    const basisText = `${basis.frictionUsd > 0 ? '-' : basis.frictionUsd < 0 ? '+' : ''}$${Math.abs(basis.frictionUsd).toFixed(2)} (${(-basis.frictionPct).toFixed(3)}%)`;
    if (!saveHedgeConfig(hedge)) return '⚠️ Не удалось сохранить конфигурацию мониторинга.';
    const savedConfig = await confirmConfigSave();
    let journal = 'CSV: позиция уже зарегистрирована.';
    if (hedge.entryJournalMarker) {
      const marker = hedge.entryJournalMarker;
      const recorded = await appendRowToCsv(formatCsvEntryRow({
        ...getCurrentTradingWeek(new Date(hedge.createdAt)), asset: norm, venue: `Wallet ${slot === 'w1' ? 1 : 2} (${slot.toUpperCase()})`,
        legDescription: `${norm} Hedge`, side: 'Hedge', entryPrice: rh.entryPrice,
        size: matched, margin: legs[0].margin + legs[1].margin, frictionUsd: basis.frictionUsd,
        notes: `${marker} ${basisSource} ${basisText}. RH ${rh.side} ${rh.size} @ ${rh.entryPrice} / Core ${core.side} ${core.size} @ ${core.entryPrice}.`,
      }), marker);
      journal = recorded ? 'CSV: вход записан.' : '⚠️ Мониторинг включён. Сохранение CSV в облаке не подтверждено.';
    }
    return [
      `✅ **${norm} ${slot.toUpperCase()}: мониторинг включён**`,
      ...legs.map((leg) => `• ${leg.name}: ${leg.size} по $${Number(leg.entryPrice.toPrecision(12))}`),
      `• ${basisSource}: **${basisText}** на ${matched} ${norm}, без комиссий и funding.`,
      ...(rh.size === core.size ? [] : [`⚠️ Незахеджированный остаток: ${Math.abs(rh.size - core.size).toPrecision(8)} ${norm} на ${rh.size > core.size ? 'RH' : 'Core'}.`]),
      journal,
      ...(savedConfig ? [] : ['⚠️ GitHub не подтвердил сохранение состояния. Повторите /o для этого кошелька.']),
    ].join('\n');
  } catch {
    return '⚠️ Данные Lighter недоступны. Вход не зарегистрирован.';
  }
}

export async function reconcileHedgesFromOnchain(refreshExisting = true): Promise<string> {
  const config = loadConfig();
  const lines = ['🔄 **Сверка с Lighter**'];
  for (const slot of ['w1', 'w2'] as const) {
    const address = walletAddress(config, slot);
    if (!address) continue;
    try {
      const accounts = await readAccounts(address);
      const symbols = new Set(accounts.flatMap((account) => account.positions.map((position) => position.symbol)));
      for (const symbol of symbols) {
        const alreadyTracked = getActiveHedges(config).some((hedge) => hedge.symbol.toUpperCase() === symbol && getHedgeWallet(config, hedge)?.slot === slot);
        if (refreshExisting || !alreadyTracked) lines.push((await activateHedgeOnchain(symbol, slot)).split('\n')[0]);
      }
      for (const hedge of getActiveHedges(config)) {
        if (getHedgeWallet(config, hedge)?.slot === slot && !symbols.has(hedge.symbol.toUpperCase())) {
          lines.push(`${hedge.symbol} ${slot.toUpperCase()}: обе ноги отсутствуют. Для подтверждённой записи нажмите «Внести выход».`);
        }
      }
    } catch {
      lines.push(`${slot.toUpperCase()}: API недоступен, мониторинг сохранён.`);
    }
  }
  return lines.join('\n');
}

const closing = new Set<string>();

export async function deactivateHedgeOnchain(symbol: string, targetWallet?: Slot, _manualExitPrice?: number, expectedOpenedAt?: number): Promise<string> {
  const norm = symbol.toUpperCase().replace(/-(USD|PERP)$/, '');
  const config = loadConfig();
  const matches = getActiveHedges(config).filter((hedge) => hedge.symbol.toUpperCase() === norm &&
    (!targetWallet || getHedgeWallet(config, hedge)?.slot === targetWallet));
  if (matches.length !== 1) return matches.length
    ? `⚠️ ${norm} активен на двух кошельках. Укажите W1 или W2.`
    : `⚠️ Активная запись ${norm} не найдена. CSV не изменён.`;
  const hedge = matches[0];
  if (expectedOpenedAt !== undefined && hedge.createdAt !== expectedOpenedAt) return '⚠️ Эта кнопка относится к другой позиции. Откройте свежий список выходов.';
  const wallet = getHedgeWallet(config, hedge);
  const rh = hedge.legs.find((leg) => leg.id.startsWith('rh_'));
  const core = hedge.legs.find((leg) => leg.id.startsWith('core_'));
  if (!wallet || hedge.legs.length !== 2 || rh?.venue !== 'lighter' || core?.venue !== 'lighter' || !Number.isFinite(hedge.createdAt)) {
    return '⚠️ Для сверки нужны кошелёк, время регистрации и две ноги Lighter. Мониторинг сохранён.';
  }

  const key = `${norm}_${wallet.slot}`;
  if (closing.has(key)) return '⏳ Сверка этого выхода уже выполняется.';
  closing.add(key);
  try {
    const accounts = await readAccounts(wallet.address);
    const remaining = livePositions(accounts, norm);
    if (remaining.some(Boolean)) return `⚠️ ${norm} ещё открыт на ${remaining.flatMap((leg, i) => leg ? [venueLabels[i]] : []).join(' и ')}. Мониторинг продолжается.`;
    const markets = accounts.map((account) => account.markets.get(norm));
    if (accounts.some((account) => !Number.isSafeInteger(account.index)) || markets.some((market) => !Number.isSafeInteger(market))) {
      return '⚠️ Не удалось определить счёт или рынок для истории исполнений. Мониторинг сохранён.';
    }
    const [rhTrade, coreTrade] = await Promise.all([rh, core].map((leg, i) =>
      readClosedCycle(venues[i], accounts[i].index!, markets[i]!, leg.side, hedge.createdAt)));
    if (!rhTrade || !coreTrade) return '⚠️ API пока не подтвердил полный цикл обеих ног. Мониторинг сохранён.';
    const trades = [rhTrade, coreTrade];
    const funding = await Promise.all(trades.map((cycle, i) => estimateCycleFunding(venues[i], markets[i]!, cycle)));
    const fundingTotal = funding[0] === null || funding[1] === null ? null : funding[0] + funding[1];
    const price = rhTrade.pricePnl + coreTrade.pricePnl;
    const fees = rhTrade.fees + coreTrade.fees;
    const closedAt = Math.max(rhTrade.closedAt, coreTrade.closedAt);
    const round = (amount: number) => Number(amount.toFixed(2));
    const marker = `[fills:${wallet.slot}:${rhTrade.id}:${coreTrade.id}]`;
    const legNotes = trades.map((cycle, i) => `${venueLabels[i]} ${cycle.side} ${cycle.size} @ ${cycle.entryPrice.toFixed(6)} → ${cycle.exitPrice.toFixed(6)}${cycle.liquidatedSize ? `, ликвидировано ${cycle.liquidatedSize}` : ''}`);
    const fundingNote = fundingTotal === null ? 'Funding недоступен.' : `Оценка funding $${fundingTotal.toFixed(2)}. Результат с этой оценкой $${(price - fees + fundingTotal).toFixed(2)}.`;
    const journaled = await appendRowToCsv(formatCsvExitRow({
      ...getCurrentTradingWeek(new Date(closedAt)), asset: norm, venue: `Wallet ${wallet.slot === 'w1' ? 1 : 2} (${wallet.slot.toUpperCase()})`,
      legDescription: `${norm} Closed Hedge`, side: 'Hedge', entryPrice: rhTrade.entryPrice, exitPrice: rhTrade.exitPrice,
      size: rhTrade.size, margin: rh.margin + core.margin, netPnl: round(price), netBalanceChange: null,
      notes: `${marker} ${new Date(closedAt).toISOString()}. ${legNotes.join(' / ')}. Комиссии $${fees.toFixed(2)}. ${fundingNote}`,
    }), marker);
    if (!journaled) return '⚠️ Исполнения подтверждены, но сохранение CSV не подтверждено. Мониторинг сохранён. Повторите запись выхода.';
    const fresh = getActiveHedges(loadConfig()).find((item) => item.symbol === hedge.symbol && getHedgeWallet(config, item)?.slot === wallet.slot);
    if (!fresh || fresh.updatedAt !== hedge.updatedAt || !deactivateHedge(norm, wallet.slot)) {
      return '⚠️ Исполнения сохранены в CSV. Состояние мониторинга изменилось во время сверки. Проверьте /status.';
    }
    if (!await confirmConfigSave()) {
      saveHedgeConfig(hedge);
      return '⚠️ Закрытие записано в CSV. GitHub не подтвердил остановку мониторинга. Повторите запись выхода.';
    }
    return [
      `✅ **${norm} ${wallet.slot.toUpperCase()}: закрытие подтверждено сделками Lighter**`,
      ...legNotes,
      `• PnL по ценам **$${price.toFixed(2)}**. Комиссии **$${fees.toFixed(2)}**. После комиссий **$${(price - fees).toFixed(2)}**.`,
      `• ${fundingNote}`,
      '• Закрытие записано в CSV. Мониторинг этой связки остановлен.',
    ].join('\n');
  } catch {
    return '⚠️ История Lighter недоступна. Закрытие не записано, мониторинг сохранён.';
  } finally {
    closing.delete(key);
  }
}
