import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveHedgeConfig, deactivateHedge } from '../config.js';
import { fetchLighterPositions, fetchLighterTicker } from '../connectors/lighter.js';
import { ThreeLegHedge } from '../types.js';

export interface EntryFrictionParams {
  rhShortPrice: number;
  arbLongPrice: number;
  size: number;
  notional: number;
}

export function getCurrentTradingWeek(): { week: string; period: string } {
  // Текущая неделя цикла в проекте — Week 7 (23.10 - 30.10)
  return {
    week: 'Week 7',
    period: '23.10 - 30.10',
  };
}

export function calculateEntryFriction(params: EntryFrictionParams): { frictionUsd: number; frictionPct: number } {
  const { rhShortPrice, arbLongPrice, size, notional } = params;
  const frictionUsd = parseFloat(((arbLongPrice - rhShortPrice) * size).toFixed(2));
  const frictionPct = notional > 0 ? parseFloat(((frictionUsd / notional) * 100).toFixed(3)) : 0;
  return { frictionUsd, frictionPct };
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
  // Format matches pnl_and_points_analysis.csv:
  // Week,Period,Asset,Venue,Leg_Description,Side,Entry_Price,Exit_Price,Size,Margin_Allocated,Initial_Deposit,Ending_Balance,Net_Price_PnL,Net_Balance_Change,Points,Cost_Per_Point_Price,Cost_Per_Point_Realized,Notes
  const noteStr = params.notes || `Opened via /o ${params.asset} (Friction: -$${params.frictionUsd})`;
  return `${params.week},${params.period},${params.asset},${params.venue},${params.legDescription},${params.side},${params.entryPrice},-,${params.size},${params.margin},${params.margin},-,0,-${params.frictionUsd},0,-,-,"${noteStr}"`;
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
  netBalanceChange: number;
  notes?: string;
}): string {
  const noteStr = params.notes || `Closed via /c ${params.asset}`;
  return `${params.week},${params.period},${params.asset},${params.venue},${params.legDescription},${params.side},${params.entryPrice},${params.exitPrice},${params.size},${params.margin},${params.margin},-,${params.netPnl > 0 ? '+' : ''}${params.netPnl},${params.netBalanceChange > 0 ? '+' : ''}${params.netBalanceChange},0,-,-,"${noteStr}"`;
}

export function appendRowToCsv(csvRow: string): void {
  const csvPath = path.resolve(process.cwd(), 'pnl_and_points_analysis.csv');
  try {
    fs.appendFileSync(csvPath, `\n${csvRow}`);
  } catch (err) {
    console.error('[PositionSync] Ошибка записи в pnl_and_points_analysis.csv:', err);
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
  exitPrice?: number;
} {
  if (!args || args.length === 0) return {};
  const symbol = args[0]?.toUpperCase().replace('-USD', '').replace('-PERP', '');
  let exitPrice: number | undefined;
  if (args.length > 1) {
    const num = parseFloat(args[1]);
    if (!isNaN(num) && num > 0) {
      exitPrice = num;
    }
  }
  return { symbol, exitPrice };
}

export async function activateHedgeOnchain(
  symbol: string,
  targetWallet?: 'w1' | 'w2',
  manualSize?: number,
  manualPrice?: number,
  manualLeverage?: number
): Promise<string> {
  const config = loadConfig();
  const normSym = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const w1 = config.wallets.robinhoodWallet1?.trim();
  const w2 = config.wallets.robinhoodWallet2?.trim();

  // 1. Определение целевого кошелька:
  let selectedWallet: 'w1' | 'w2' = targetWallet || 'w1';
  let targetAddr = selectedWallet === 'w2' ? (w2 || w1) : (w1 || w2);
  let targetName = selectedWallet === 'w2' ? 'Wallet 2 (W2)' : 'Wallet 1 (W1)';

  let rhPositions: Awaited<ReturnType<typeof fetchLighterPositions>> = [];
  let arbPositions: Awaited<ReturnType<typeof fetchLighterPositions>> = [];

  if (targetWallet) {
    [rhPositions, arbPositions] = await Promise.all([
      fetchLighterPositions(targetAddr || '', 'rh'),
      fetchLighterPositions(targetAddr || '', 'arb'),
    ]);
  } else {
    // Автодетект кошелька: проверяем W1
    const [w1Rh, w1Arb] = await Promise.all([
      w1 ? fetchLighterPositions(w1, 'rh') : Promise.resolve([]),
      w1 ? fetchLighterPositions(w1, 'arb') : Promise.resolve([]),
    ]);

    const hasOnW1 = w1Rh.some((p) => p.symbol === normSym) || w1Arb.some((p) => p.symbol === normSym);

    if (hasOnW1 || !w2) {
      selectedWallet = 'w1';
      targetAddr = w1;
      targetName = 'Wallet 1 (W1)';
      rhPositions = w1Rh;
      arbPositions = w1Arb;
    } else {
      // Проверяем W2
      const [w2Rh, w2Arb] = await Promise.all([
        fetchLighterPositions(w2, 'rh'),
        fetchLighterPositions(w2, 'arb'),
      ]);
      const hasOnW2 = w2Rh.some((p) => p.symbol === normSym) || w2Arb.some((p) => p.symbol === normSym);
      if (hasOnW2) {
        selectedWallet = 'w2';
        targetAddr = w2;
        targetName = 'Wallet 2 (W2)';
        rhPositions = w2Rh;
        arbPositions = w2Arb;
      } else {
        selectedWallet = 'w1';
        targetAddr = w1;
        targetName = 'Wallet 1 (W1)';
        rhPositions = w1Rh;
        arbPositions = w1Arb;
      }
    }
  }

  // 2. Поиск ног позиции на Robinhood и Arbitrum
  const rhPos = rhPositions.find((p) => p.symbol === normSym);
  const arbPos = arbPositions.find((p) => p.symbol === normSym);
  const existingHedge = config.hedges?.find((h) => h.symbol.toUpperCase() === normSym);

  // 3. Вычисление размера (Приоритет: manualSize -> onchain RH -> onchain Arb -> existing -> 10)
  const size = manualSize || rhPos?.size || arbPos?.size || existingHedge?.legs[0]?.size || 10;
  const rhSize = manualSize || rhPos?.size || size;
  const arbSize = manualSize || arbPos?.size || size;

  // 4. Вычисление цен входа
  const rhEntryPrice =
    manualPrice || rhPos?.entryPrice || arbPos?.entryPrice || existingHedge?.legs[0]?.entryPrice || 100;
  const arbEntryPrice =
    arbPos?.entryPrice ||
    (manualPrice ? manualPrice * 1.0005 : undefined) ||
    existingHedge?.legs[1]?.entryPrice ||
    rhEntryPrice;

  const rhSide: 'long' | 'short' = rhPos?.side || 'short';
  const arbSide: 'long' | 'short' = arbPos?.side || 'long';

  // 5. Определение маржи и плеча:
  // Приоритет: явный manualLeverage -> реальный collateral из ончейна Lighter -> existing -> 7.92x
  const notional = size * rhEntryPrice;
  const onchainCollateral = rhPos?.accountCollateral || arbPos?.accountCollateral;

  let leverage: number;
  let margin: number;

  if (manualLeverage && manualLeverage > 0) {
    leverage = manualLeverage;
    margin = Math.round(notional / leverage);
  } else if (onchainCollateral && onchainCollateral > 0) {
    margin = parseFloat(onchainCollateral.toFixed(2));
    leverage = parseFloat((notional / margin).toFixed(2));
  } else if (existingHedge?.legs[0]?.leverage) {
    leverage = existingHedge.legs[0].leverage;
    margin = existingHedge.legs[0].margin;
  } else {
    leverage = 7.92;
    margin = Math.round(notional / leverage);
  }

  // 6. Цены ликвидации (из ончейна Lighter либо расчетные по MMR)
  const rhLiq =
    rhPos?.liquidationPrice && rhPos.liquidationPrice > 0
      ? rhPos.liquidationPrice
      : parseFloat(
          (rhEntryPrice * (rhSide === 'short' ? 1 + 1 / leverage - 0.06 : 1 - 1 / leverage + 0.06)).toFixed(2)
        );

  const arbLiq =
    arbPos?.liquidationPrice && arbPos.liquidationPrice > 0
      ? arbPos.liquidationPrice
      : parseFloat(
          (arbEntryPrice * (arbSide === 'short' ? 1 + 1 / leverage - 0.06 : 1 - 1 / leverage + 0.06)).toFixed(2)
        );

  const updatedHedge: ThreeLegHedge = {
    symbol: normSym,
    active: true,
    legs: [
      {
        id: `rh_${normSym.toLowerCase()}_short`,
        name: `${targetName} (${rhSide === 'short' ? 'Short' : 'Long'})`,
        venue: 'lighter',
        side: rhSide,
        margin,
        entryPrice: parseFloat(rhEntryPrice.toFixed(3)),
        leverage,
        size: parseFloat(rhSize.toFixed(4)),
        liquidationPrice: parseFloat(rhLiq.toFixed(2)),
        walletAddress: targetAddr,
      },
      {
        id: `core_${normSym.toLowerCase()}_long`,
        name: `Lighter Core (${targetName}) (${arbSide === 'short' ? 'Short' : 'Long'})`,
        venue: 'lighter',
        side: arbSide,
        margin,
        entryPrice: parseFloat(arbEntryPrice.toFixed(3)),
        leverage,
        size: parseFloat(arbSize.toFixed(4)),
        liquidationPrice: parseFloat(arbLiq.toFixed(2)),
        walletAddress: targetAddr,
      },
    ],
    createdAt: existingHedge?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  saveHedgeConfig(updatedHedge);

  // 7. Логирование в CSV
  const { week, period } = getCurrentTradingWeek();
  const entryFriction = calculateEntryFriction({
    rhShortPrice: updatedHedge.legs[0].entryPrice,
    arbLongPrice: updatedHedge.legs[1].entryPrice,
    size: updatedHedge.legs[0].size,
    notional: margin * leverage,
  });

  const nowFormatted = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const csvRow = formatCsvEntryRow({
    week,
    period,
    asset: normSym,
    venue: targetName,
    legDescription: `${normSym} Hedge`,
    side: 'Delta-Neutral',
    entryPrice: updatedHedge.legs[0].entryPrice,
    size: updatedHedge.legs[0].size,
    margin,
    frictionUsd: entryFriction.frictionUsd,
    notes: `Opened via /o ${normSym} (${nowFormatted}. Friction: -$${entryFriction.frictionUsd}, Leverage: ${leverage}x)`,
  });
  appendRowToCsv(csvRow);

  const dataSourceNote =
    rhPos || arbPos
      ? '🔗 Ончейн Lighter API (live)'
      : manualSize
      ? '✍️ Ручной ввод'
      : '⚙️ Конфигурация / Fallback';

  return [
    `✅ **ПОЗИЦИЯ ${normSym} УСПЕШНО АКТИВИРОВАНА!**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• Источник данных: **${dataSourceNote}**`,
    `• Период: **${week} (${period})**`,
    `• Кошелек: **${targetName}** (\`${targetAddr?.slice(0, 6)}...${targetAddr?.slice(-4)}\`)`,
    `• Нога RH (${rhSide === 'short' ? 'Short' : 'Long'}): **${updatedHedge.legs[0].size} ${normSym}** по **$${updatedHedge.legs[0].entryPrice}** (${leverage}x) [Ликв: **$${updatedHedge.legs[0].liquidationPrice}**]`,
    `• Нога Arb (${arbSide === 'short' ? 'Short' : 'Long'}): **${updatedHedge.legs[1].size} ${normSym}** по **$${updatedHedge.legs[1].entryPrice}** (${leverage}x) [Ликв: **$${updatedHedge.legs[1].liquidationPrice}**]`,
    `• Маржа: **$${margin}** | Плечо: **${leverage}x**`,
    `• Расчётный спред входа: **-$${entryFriction.frictionUsd}** (${entryFriction.frictionPct}%)`,
    `• Запись внесена в \`pnl_and_points_analysis.csv\``,
    `• 🚨 **Мониторинг ликвидаций и сирена: АКТИВИРОВАНЫ**`,
  ].join('\n');
}

export async function deactivateHedgeOnchain(symbol: string, manualExitPrice?: number): Promise<string> {
  const normSym = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const config = loadConfig();
  const hedge = config.hedges?.find((h) => h.symbol.toUpperCase() === normSym) || config.currentHedge;

  const success = deactivateHedge(normSym);
  if (!success) {
    return `⚠️ Связка **${normSym}** не найдена среди активных в настройках.`;
  }

  const ticker = await fetchLighterTicker(normSym);
  const exitPrice = manualExitPrice || ticker?.lastTradePrice || ticker?.markPrice || hedge?.legs[0]?.entryPrice || 0;

  const { week, period } = getCurrentTradingWeek();

  // Расчет длительности удержания позиции
  const openedAt = hedge?.createdAt || (Date.now() - 24 * 3600 * 1000);
  const closedAt = Date.now();
  const durationMs = Math.max(0, closedAt - openedAt);
  const durationHours = parseFloat((durationMs / (1000 * 60 * 60)).toFixed(1));

  const openDateStr = new Date(openedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const closeDateStr = new Date(closedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const rhLeg = hedge?.legs?.find((l) => l.side === 'short') || hedge?.legs?.[0];
  const arbLeg = hedge?.legs?.find((l) => l.side === 'long') || hedge?.legs?.[1];

  const rhEntry = rhLeg?.entryPrice || exitPrice;
  const arbEntry = arbLeg?.entryPrice || exitPrice;
  const rhSize = rhLeg?.size || 0;
  const arbSize = arbLeg?.size || 0;
  const totalMargin = (rhLeg?.margin || 0) + (arbLeg?.margin || 0);

  // Расчет реального PnL:
  // Short PnL = (entry - exit) * size
  // Long PnL = (exit - entry) * size
  const rhPnl = parseFloat(((rhEntry - exitPrice) * rhSize).toFixed(2));
  const arbPnl = parseFloat(((exitPrice - arbEntry) * arbSize).toFixed(2));
  const netPnl = parseFloat((rhPnl + arbPnl).toFixed(2));
  const netBalanceChange = netPnl;

  const durationNote = `${durationHours}ч (с ${openDateStr} по ${closeDateStr})`;
  const netPnlStr = netPnl >= 0 ? `+$${netPnl}` : `-$${Math.abs(netPnl)}`;
  const rhPnlStr = rhPnl >= 0 ? `+$${rhPnl}` : `-$${Math.abs(rhPnl)}`;
  const arbPnlStr = arbPnl >= 0 ? `+$${arbPnl}` : `-$${Math.abs(arbPnl)}`;
  const notes = `Closed via /c ${normSym} (${durationNote}. Exit: $${exitPrice}, Net PnL: ${netPnlStr})`;

  const csvRow = formatCsvExitRow({
    week,
    period,
    asset: normSym,
    venue: 'Robinhood + Arbitrum',
    legDescription: `${normSym} Closed Hedge`,
    side: 'Delta-Neutral',
    entryPrice: rhEntry,
    exitPrice,
    size: rhSize,
    margin: totalMargin,
    netPnl,
    netBalanceChange,
    notes,
  });
  appendRowToCsv(csvRow);

  return [
    `🛑 **ПОЗИЦИЯ ${normSym} УСПЕШНО ЗАКРЫТА!**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• Связка деактивирована в \`config.json\` (\`active: false\`).`,
    `• ⏱ **Время удержания:** **${durationNote}**`,
    `• 💵 **Цены исполнения:** Вход RH: **$${rhEntry}** | Arb: **$${arbEntry}** ➔ Выход: **$${exitPrice}**`,
    `• 📊 **Финансовый результат:**`,
    `  - RH Short: **${rhPnlStr}**`,
    `  - Arb Long: **${arbPnlStr}**`,
    `  - Итоговый Net PnL: **${netPnlStr}**`,
    `• 🔕 **Мониторинг ликвидаций и сирена по ${normSym} остановлены.**`,
    `• 📝 Запись с датами и результатом внесена в \`pnl_and_points_analysis.csv\`.`,
  ].join('\n');
}

