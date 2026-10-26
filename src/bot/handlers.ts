import { ThreeLegHedge, RiskAssessment, SpikeAlert, Venue } from '../types.js';
import { getMarketInfo, scanSharedMarkets } from '../services/marketScanner.js';
import { evaluateHedgeRisk } from '../services/riskEngine.js';
import { calculateSafeLeverage } from '../services/calculator.js';
import { fetchLighterPositions } from '../connectors/lighter.js';
import { loadConfig, saveHedgeConfig, updateWallets, getActiveHedges } from '../config.js';
import { sleep, sleepByRange, getRandomNumber } from '../utils/sleep.js';
import { fetchLiveWalletEquity, calculateWalletRebalance, formatRebalanceReport, RebalanceResult } from '../services/rebalanceService.js';
import { scanCanonicalMarketMatrix, calculateActiveHedgesExitReport } from '../services/marketMatrixService.js';
import { activateHedgeOnchain, deactivateHedgeOnchain, parseOpenCommandArgs, parseCloseCommandArgs, getCurrentTradingWeek } from '../services/positionSyncService.js';


export async function handleStatusCommand(hedge?: ThreeLegHedge): Promise<string> {
  const config = loadConfig();
  const hedges = hedge ? [hedge] : getActiveHedges(config);

  if (hedges.length === 0) {
    return '❌ Нет активных связок для мониторинга.';
  }

  const reports: string[] = [];
  let grandTotalMargin = 0;
  let grandTotalPnl = 0;

  for (const h of hedges) {
    const market = await getMarketInfo(h.symbol);
    if (!market) {
      reports.push(`❌ Не удалось получить котировки для рынка **${h.symbol}**. Проверьте подключение к API.`);
      continue;
    }

    const summary = evaluateHedgeRisk(
      h,
      {
        lighterPrice: market.lighterMarkPrice,
        polymarketPrice: market.polymarketMarkPrice,
      },
      config.thresholds.warningBufferPct,
      config.thresholds.criticalBufferPct
    );

    grandTotalMargin += summary.totalMargin;
    grandTotalPnl += summary.totalUnrealizedPnl;

    let statusIcon = '🟢';
    let statusText = 'ВСЁ СПОКОЙНО';
    if (summary.lowestBufferLeg.status === 'critical') {
      statusIcon = '🚨';
      statusText = 'КРИТИЧЕСКАЯ ОПАСНОСТЬ ЛИКВИДАЦИИ';
    } else if (summary.lowestBufferLeg.status === 'warning') {
      statusIcon = '⚠️';
      statusText = 'ВНИМАНИЕ: СОКРАЩЕНИЕ БУФЕРА';
    }

    const lines: string[] = [
      `${statusIcon} **МОНИТОРИНГ СВЯЗКИ: ${h.symbol}** (${statusText})`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📊 **Котировка Lighter:** **$${market.lighterMarkPrice.toFixed(2)}**`,
      ``,
      `🛡 **Состояние позиций (${h.legs.length}):**`,
    ];

    for (const leg of summary.legs) {
      const icon = leg.status === 'critical' ? '🔴' : leg.status === 'warning' ? '🟡' : '🔹';
      const sideName = leg.side === 'long' ? '📈 LONG' : '📉 SHORT';
      const pnlSign = leg.unrealizedPnl >= 0 ? '+' : '';

      lines.push(
        `${icon} **${leg.name}** [${sideName}]`,
        `   Маржа: $${leg.margin} (${leg.leverage || 7}x | $${(leg.margin * (leg.leverage || 7)).toFixed(2)} notional | ${leg.size || ''} ${h.symbol})`,
        `   Вход: $${leg.entryPrice.toFixed(2)} | Ликвидация: **$${leg.liquidationPrice.toFixed(2)}**`,
        `   Запас хода: **${leg.distanceToLiqPct}%** ($${leg.distanceToLiqUsd}) | PnL: **${pnlSign}$${leg.unrealizedPnl}**`,
        ``
      );
    }

    const totalPnlSign = summary.totalUnrealizedPnl >= 0 ? '+' : '';
    lines.push(
      `💰 **Итого ${h.symbol}:** Маржа $${summary.totalMargin.toFixed(2)} | Дельта: $${summary.netDeltaUsd} | PnL: **${totalPnlSign}$${summary.totalUnrealizedPnl}** | Мин. буфер: **${summary.lowestBufferLeg.distanceToLiqPct}%**`
    );

    reports.push(lines.join('\n'));
  }

  if (hedges.length > 1) {
    const grandSign = grandTotalPnl >= 0 ? '+' : '';
    reports.push(
      `════════════════════\n💼 **ОБЩИЙ ИТОГ ПОРТФЕЛЯ (${hedges.length} связки):**\n` +
      `• Совокупная маржа: **$${grandTotalMargin.toFixed(2)}**\n` +
      `• Совокупный плавающий PnL: **${grandSign}$${grandTotalPnl.toFixed(2)}**`
    );
  }

  return reports.join('\n\n');
}

export async function handleMarketsCommand(limit = 12): Promise<string> {
  const list = await scanSharedMarkets(limit);
  if (list.length === 0) {
    return '❌ Не удалось загрузить список общих рынков.';
  }

  const lines: string[] = [
    `🌐 **ОБЩИЕ РЫНКИ (ROBINHOOD & POLYMARKET)**`,
    `Сравнение цен и ставок фандинга:`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const m of list) {
    const spread = m.priceSpreadPct > 0 ? `+${m.priceSpreadPct}%` : `${m.priceSpreadPct}%`;
    lines.push(
      `🔹 **${m.symbol}**: RH $${m.lighterPrice} | Poly $${m.polymarketPrice} (спред ${spread})`,
      `   Фандинг 1ч: RH ${(m.lighterFunding1hPct).toFixed(4)}% vs Poly ${(m.polymarketFunding1hPct).toFixed(4)}%`,
      `   💡 ${m.recommendedDirection}`,
      ``
    );
  }

  lines.push(`Для выбора актива введите: \`/select СИМВОЛ\` (например, \`/select NVDA\`)`);
  return lines.join('\n');
}

export function handleCalcCommand(args: string[]): string {
  // Формат: /calc [symbol] [margin] [timeframe]
  // Пример: /calc TSM 1200 24h
  let symbol = 'TSM';
  let margin = 1000;
  let timeframe: '24h' | '7d' = '24h';

  if (args.length >= 1 && isNaN(Number(args[0]))) {
    symbol = args[0].toUpperCase();
  }

  const numArg = args.find((a) => !isNaN(Number(a)));
  if (numArg) {
    margin = parseFloat(numArg);
  }

  if (args.some((a) => a.toLowerCase() === '7d' || a.toLowerCase() === 'week' || a.toLowerCase() === 'неделя')) {
    timeframe = '7d';
  }

  const rec = calculateSafeLeverage(symbol, margin, timeframe);

  const lines: string[] = [
    `🧮 **АНАЛИЗАТОР БЕЗОПАСНОГО ПЛЕЧА: ${rec.symbol}**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⏱ Горизонт удержания: **${rec.timeframe === '24h' ? '24 часа (1 сутки)' : '7 дней (1 неделя)'}**`,
    `📈 Историческая волатильность: **${rec.estimatedVolPct}%** годовых`,
    `📉 Ожидаемый макс. ход цены: **±${rec.maxExpectedMovePct}%**`,
    ``,
    `🎯 **РЕКОМЕНДОВАННОЕ ПЛЕЧО: ${rec.recommendedLeverage}x**`,
    `🛡 Запас хода до ликвидации: **${rec.distanceToLiqPct}%**`,
    `💬 *${rec.verdict}*`,
    ``,
    `⚖️ **Распределение депозита (дельта 0):**`,
    `• Robinhood Long: **$${rec.split.leg1RobinhoodLong.margin}** (номинал $${rec.split.leg1RobinhoodLong.notional})`,
    `• Robinhood Short: **$${rec.split.leg2RobinhoodShort.margin}** (номинал $${rec.split.leg2RobinhoodShort.notional})`,
    `• Polymarket Short: **$${rec.split.leg3PolymarketShort.margin}** (номинал $${rec.split.leg3PolymarketShort.notional})`,
  ];

  return lines.join('\n');
}

export async function handleFundingCommand(symbol: string): Promise<string> {
  const market = await getMarketInfo(symbol);
  if (!market) {
    return `❌ Рынок ${symbol} не найден.`;
  }

  const lFund1h = market.lighterFundingRate1h * 100;
  const pFund1h = market.polymarketFundingRate1h * 100;
  const lFund24h = lFund1h * 24;
  const pFund24h = pFund1h * 24;

  const lines = [
    `💸 **СТАВКИ ФАНДИНГА: ${symbol}**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• Robinhood (Lighter): **${lFund1h.toFixed(5)}%** в 1ч (сутки: ${lFund24h.toFixed(4)}%)`,
    `• Polymarket Perps: **${pFund1h.toFixed(5)}%** в 1ч (сутки: ${pFund24h.toFixed(4)}%)`,
    `• Разница (RH - Poly): **${market.fundingDiff1hPct.toFixed(5)}%** в 1ч`,
    ``,
  ];

  if (lFund1h > pFund1h) {
    lines.push(`💡 Лонги на Lighter платят шортам больше. **Выгодно держать ШОРТ на Lighter, а ЛОНГ на Polymarket**.`);
  } else {
    lines.push(`💡 Шорты получают больше на Polymarket. **Выгодно держать ШОРТ на Polymarket, а ЛОНГ на Lighter**.`);
  }

  return lines.join('\n');
}

export function handlePolyWalletCommand(address: string): string {
  if (!address || !address.startsWith('0x') || address.length < 10) {
    return '❌ Пожалуйста, укажите валидный адрес кошелька Polymarket. Пример:\n`/poly 0x1234567890abcdef1234567890abcdef12345678`';
  }

  updateWallets({ polymarketWallet: address.trim() });
  return `✅ **Адрес кошелька Polymarket успешно обновлен:**\n\`${address.trim()}\`\n\nПри следующем нажатии \`/sync\` бот свяжет позиции с этого адреса.`;
}

export function formatRiskAlert(assessment: RiskAssessment, symbol: string): string {
  const icon = assessment.status === 'critical' ? '🚨' : '⚠️';
  const header = assessment.status === 'critical' ? 'КРИТИЧЕСКАЯ УГРОЗА ЛИКВИДАЦИИ!' : 'ПРЕДУПРЕЖДЕНИЕ: БУФЕР СОКРАЩАЕТСЯ';
  const sideName = assessment.side === 'long' ? '📈 LONG' : '📉 SHORT';
  const pnlSign = assessment.unrealizedPnl >= 0 ? '+' : '';

  return [
    `${icon} **${header}**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Актив: **${symbol}**`,
    `Позиция: **${assessment.name}** ${sideName}`,
    `• Текущая цена: **$${assessment.currentPrice.toFixed(2)}**`,
    `• Цена входа: **$${assessment.entryPrice.toFixed(2)}**`,
    `• Цена ликвидации: **$${assessment.liquidationPrice.toFixed(2)}**`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ **ОСТАВШИЙСЯ ЗАПАС ХОДА: ${assessment.distanceToLiqPct}% ($${assessment.distanceToLiqUsd})**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `• Маржа: $${assessment.margin} (${assessment.leverage || 6}x | PnL: ${pnlSign}$${assessment.unrealizedPnl})`,
    ``,
    `💡 Рекомендация: долейте маржу (Add Margin) на ${assessment.venue === 'lighter' ? 'Robinhood' : 'Polymarket'} или частично закройте связку.`,
  ].join('\n');
}

export function formatSpikeAlert(spike: SpikeAlert): string {
  const direction = spike.changePct > 0 ? 'ВСПЛЕСК ВВЕРХ ↗️' : 'ОБВАЛ ВНИЗ ↘️';
  return [
    `⚡️ **ОБНАРУЖЕН РЕЗКИЙ СКВИЗ: ${spike.symbol}** (${direction})`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Изменение: **${spike.changePct > 0 ? '+' : ''}${spike.changePct}% за ${spike.windowMinutes} мин**`,
    `Было: $${spike.startPrice.toFixed(2)} ➔ Стало: **$${spike.currentPrice.toFixed(2)}**`,
    `Мониторинг позиций переведен в режим повышенной готовности. Проверьте статус через \`/status\`.`,
  ].join('\n');
}

export async function handleSyncCommand(
  onProgress?: (text: string) => Promise<void>
): Promise<string> {
  const config = loadConfig();
  const w1 = config.wallets.robinhoodWallet1?.trim();
  const w2 = config.wallets.robinhoodWallet2?.trim();

  if (!w1 || !w2) {
    return [
      `⚠️ **Кошельки не указаны в настройках!**`,
      `Чтобы включить авто-синхронизацию, укажите адреса кошельков Robinhood в файле \`config.json\` (поля \`robinhoodWallet1\` и \`robinhoodWallet2\`).`,
      ``,
      `Для Polymarket укажите кошелек через команду \`/poly 0x...\`.`,
    ].join('\n');
  }

  const symbol = config.currentHedge.symbol;
  if (onProgress) {
    await onProgress(`🔍 [1/2] Запрашиваю данные по кошельку Robinhood 1...`);
  }

  // 1. Запрос по первому кошельку через публичный эксплорер
  const pos1 = await fetchLighterPositions(w1);
  const foundPos1 = pos1.find((p) => p.symbol === symbol || p.symbol.includes(symbol));

  // 2. Anti-Sybil рандомизированная задержка
  const delaySec = getRandomNumber(15, 25);
  if (onProgress) {
    await onProgress(
      `🛡 **Anti-Sybil защита:** Запрос Robinhood 1 выполнен.\nВыдерживаю естественную паузу **${delaySec} сек** перед запросом Robinhood 2...`
    );
  }
  await sleep(delaySec * 1000);

  // 3. Запрос по второму кошельку
  const pos2 = await fetchLighterPositions(w2);
  const foundPos2 = pos2.find((p) => p.symbol === symbol || p.symbol.includes(symbol));

  const hedge = config.currentHedge;

  if (foundPos1) {
    hedge.legs[0].entryPrice = foundPos1.entryPrice;
    hedge.legs[0].size = foundPos1.size;
    hedge.legs[0].side = foundPos1.side;
  }

  if (foundPos2) {
    hedge.legs[1].entryPrice = foundPos2.entryPrice;
    hedge.legs[1].size = foundPos2.size;
    hedge.legs[1].side = foundPos2.side;
  }

  hedge.active = true;
  hedge.updatedAt = Date.now();
  saveHedgeConfig(hedge);

  const lines = [
    `✅ **СИНХРОНИЗАЦИЯ УСПЕШНО ЗАВЕРШЕНА!**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🛡 **Anti-Sybil защита:** между кошельками Robinhood выдержана пауза **${delaySec} сек**.`,
    `📌 Активный рынок: **${symbol}**`,
    ``,
    `• Robinhood 1: ${foundPos1 ? `найдена позиция ${foundPos1.side.toUpperCase()} по $${foundPos1.entryPrice} (размер: ${foundPos1.size})` : 'позиция на бирже не найдена (сохранены параметры по умолчанию)'}`,
    `• Robinhood 2: ${foundPos2 ? `найдена позиция ${foundPos2.side.toUpperCase()} по $${foundPos2.entryPrice} (размер: ${foundPos2.size})` : 'позиция на бирже не найдена (сохранены параметры по умолчанию)'}`,
    ``,
    `Связка взята на круглосуточный мониторинг. Проверьте статус через \`/status\`.`,
  ];

  return lines.join('\n');
}

export async function handleRebalanceCommand(targetWalletArg?: string): Promise<string> {
  const config = loadConfig();
  const w1Addr = config.wallets.robinhoodWallet1?.trim();
  const w2Addr = config.wallets.robinhoodWallet2?.trim();

  const reports: RebalanceResult[] = [];
  const arg = targetWalletArg?.toLowerCase().trim();

  if (arg === 'w1' && w1Addr) {
    const live = await fetchLiveWalletEquity(w1Addr);
    reports.push(
      calculateWalletRebalance({
        walletName: 'Wallet 1 (W1)',
        walletAddress: w1Addr,
        rhEquity: live.rhEquity,
        rhCollateral: live.rhCollateral,
        arbEquity: live.arbEquity,
        arbCollateral: live.arbCollateral,
      })
    );
  } else if (arg === 'w2' && w2Addr) {
    const live = await fetchLiveWalletEquity(w2Addr);
    reports.push(
      calculateWalletRebalance({
        walletName: 'Wallet 2 (W2)',
        walletAddress: w2Addr,
        rhEquity: live.rhEquity,
        rhCollateral: live.rhCollateral,
        arbEquity: live.arbEquity,
        arbCollateral: live.arbCollateral,
      })
    );
  } else {
    // Both wallets
    const [w1Live, w2Live] = await Promise.all([
      w1Addr ? fetchLiveWalletEquity(w1Addr) : Promise.resolve({ rhEquity: 0, rhCollateral: 0, arbEquity: 0, arbCollateral: 0 }),
      w2Addr ? fetchLiveWalletEquity(w2Addr) : Promise.resolve({ rhEquity: 0, rhCollateral: 0, arbEquity: 0, arbCollateral: 0 }),
    ]);

    if (w1Addr) {
      reports.push(
        calculateWalletRebalance({
          walletName: 'Wallet 1 (W1)',
          walletAddress: w1Addr,
          rhEquity: w1Live.rhEquity,
          rhCollateral: w1Live.rhCollateral,
          arbEquity: w1Live.arbEquity,
          arbCollateral: w1Live.arbCollateral,
        })
      );
    }

    if (w2Addr) {
      reports.push(
        calculateWalletRebalance({
          walletName: 'Wallet 2 (W2)',
          walletAddress: w2Addr,
          rhEquity: w2Live.rhEquity,
          rhCollateral: w2Live.rhCollateral,
          arbEquity: w2Live.arbEquity,
          arbCollateral: w2Live.arbCollateral,
        })
      );
    }
  }

  if (reports.length === 0) {
    return '❌ В config.json не указаны адреса кошельков для расчета ребалансировки.';
  }

  return formatRebalanceReport(reports);
}

export async function handleMarketMatrixCommand(
  mode: 'open' | 'close' = 'open',
  targetWallet?: 'w1' | 'w2' | 'all'
): Promise<{
  topCardsText: string;
  fileContent: string;
}> {
  return scanCanonicalMarketMatrix(mode, targetWallet);
}

export async function handleActiveHedgesExitCommand(): Promise<{
  text: string;
  inlineKeyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}> {
  return calculateActiveHedgesExitReport();
}

export { activateHedgeOnchain, deactivateHedgeOnchain, parseOpenCommandArgs, parseCloseCommandArgs, getCurrentTradingWeek };

