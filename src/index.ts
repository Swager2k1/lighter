import { loadConfig, saveHedgeConfig, getActiveHedges } from './config.js';
import { getMarketInfo } from './services/marketScanner.js';
import { evaluateHedgeRisk } from './services/riskEngine.js';
import { globalSpikeDetector } from './services/spikeDetector.js';
import { TelegramBotService } from './bot/telegram.js';
import { CriticalAlertBotService } from './bot/criticalBot.js';
import { handleStatusCommand } from './bot/handlers.js';
import { ThreeLegHedge } from './types.js';

let isRunning = true;

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   🚀 LIGHTER-POLY DELTA-NEUTRAL RISK & HEDGE MONITOR');
  console.log('   🛡  100% Anti-Sybil / Zero-Exposure Anonymous Polling');
  console.log('   🚨 Двойной бот: Обычный (инфо) + Критический (сирена)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const config = loadConfig();
  const initialHedges = getActiveHedges(config);
  const symbolsList = initialHedges.map((h) => h.symbol).join(', ');

  console.log(`📌 Активные рынки: ${symbolsList}`);
  console.log(`⏱ Интервал опроса публичных цен: ${config.pollIntervalMs / 1000} сек`);
  console.log(`⚠️ Пороги: Предупреждение <= ${config.thresholds.warningBufferPct}%, Тревога <= ${config.thresholds.criticalBufferPct}%\n`);

  // 1. Основной бот (информационный/командный, звук отключен пользователем)
  const bot = new TelegramBotService(config.telegram.botToken, config.telegram.chatId);
  bot.startPolling();

  // 2. Второй бот (только критические алерты: <= 2.5%, шаг 0.25%, сирена <= 1.5%)
  const criticalBot = new CriticalAlertBotService(config.telegram.criticalBotToken, config.telegram.chatId);
  if (criticalBot.isConfigured()) {
    criticalBot.startPolling(async () => handleStatusCommand());
  }

  // Отправка стартовых сообщений
  if (config.telegram.chatId && config.telegram.botToken) {
    await bot.sendMessage(
      config.telegram.chatId,
      `🟢 **Монитор запущен!**\nАктивные рынки: **${symbolsList}**\nДля проверки введите \`/status\` или \`/help\`.`
    );
  }

  if (config.telegram.chatId && criticalBot.isConfigured()) {
    await criticalBot.sendMessage(
      config.telegram.chatId,
      `🚨 **Критический бот-сирена успешно активирован!**\n` +
      `• Первое предупреждение: при запасе хода <= **2.50%**\n` +
      `• Шаг уведомлений: каждые **0.25%** (2.25%, 2.00%, 1.75%)\n` +
      `• 🚨 **Зона сирены:** при <= **1.50%** — непрерывные громкие алерты со звуком каждые 15 сек!\n\n` +
      `Убедитесь, что для этого чата звук включен на максимум.`
    );
  }

  let cycleCount = 0;

  // Главный анонимный цикл мониторинга
  while (isRunning) {
    try {
      cycleCount++;
      const currentConfig = loadConfig();
      const thresholds = currentConfig.thresholds;
      const activeHedges = getActiveHedges(currentConfig);

      for (const hedge of activeHedges) {
        // 1. Анонимный опрос публичных цен
        const market = await getMarketInfo(hedge.symbol);

        if (market && market.lighterMarkPrice > 0) {
          // 2. Проверка на сквизы
          const spike = globalSpikeDetector.addTick(
            hedge.symbol,
            market.lighterMarkPrice,
            thresholds
          );

          if (spike) {
            console.warn(`[СКВИЗ] Обнаружен скачок цены ${spike.symbol}: ${spike.changePct}% за ${spike.windowMinutes}м`);
            await bot.dispatchSpikeAlert(spike);
          }

          // 3. Оценка риска связки
          const summary = evaluateHedgeRisk(
            hedge,
            {
              lighterPrice: market.lighterMarkPrice,
              polymarketPrice: market.polymarketMarkPrice,
            },
            thresholds.warningBufferPct,
            thresholds.criticalBufferPct
          );

          // 4. Диспетчеризация алертов
          // Основной бот (инфо/предупреждения, звук отключен)
          await bot.dispatchRiskAlerts(summary.legs, hedge.symbol);

          // Критический бот (только угрозы: <= 2.5%, шаг 0.25%, сирена <= 1.5%)
          if (criticalBot.isConfigured()) {
            await criticalBot.dispatchCriticalAlerts(summary.legs, hedge.symbol);
          }

          // Лог состояния в консоль каждые 4 цикла (~1 минута)
          if (cycleCount % 4 === 0) {
            const time = new Date().toLocaleTimeString();
            const lowest = summary.lowestBufferLeg;
            const pnlSign = summary.totalUnrealizedPnl >= 0 ? '+' : '';
            console.log(
              `[${time}] ${hedge.symbol}: RH $${market.lighterMarkPrice.toFixed(2)} | ` +
              `Мин. буфер: ${lowest.name} (${lowest.distanceToLiqPct}%) | ` +
              `PnL: ${pnlSign}$${summary.totalUnrealizedPnl} | Дельта: $${summary.netDeltaUsd}`
            );
          }
        }
      }
    } catch (err) {
      console.error('[Monitor] Ошибка в цикле мониторинга:', err);
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }

  bot.stopPolling();
  criticalBot.stopPolling();
  console.log('🛑 Сервис остановлен.');
}

process.on('SIGINT', () => {
  console.log('\nПолучен сигнал завершения (SIGINT)...');
  isRunning = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nПолучен сигнал завершения (SIGTERM)...');
  isRunning = false;
  process.exit(0);
});

main().catch((err) => {
  console.error('Критическая ошибка запуска:', err);
});
