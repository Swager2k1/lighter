import { FullConfig, loadConfig, saveHedgeConfig, updateWallets, getActiveHedges, deactivateHedge } from '../config.js';
import {
  handleStatusCommand,
  handleMarketsCommand,
  handleCalcCommand,
  handleFundingCommand,
  handlePolyWalletCommand,
  handleSyncCommand,
  formatRiskAlert,
  formatSpikeAlert,
  handleRebalanceCommand,
  handleMarketMatrixCommand,
  handleActiveHedgesExitCommand,
  activateHedgeOnchain,
  deactivateHedgeOnchain,
  parseOpenCommandArgs,
  parseCloseCommandArgs,
} from './handlers.js';
import { RiskAssessment, SpikeAlert, ThreeLegHedge } from '../types.js';

export const MAIN_MENU_KEYBOARD = {
  keyboard: [
    [{ text: '📊 Статус (/status)' }, { text: '⚖️ Бридж (/b)' }],
    [{ text: '📈 Анализ входа (/o)' }, { text: '➕ Внести вход (/o)' }],
    [{ text: '📉 Анализ выхода (/c)' }, { text: '🛑 Внести выход (/c)' }],
  ],
  resize_keyboard: true,
  persistent: true,
};

export class TelegramBotService {
  private token: string;
  private chatId: string;
  private isPolling = false;
  private lastUpdateId = 0;
  private mutedUntil = 0;
  private lastAlertTimes: Map<string, number> = new Map();
  private alertCooldownMs = 10 * 60 * 1000; // 10 минут между предупреждениями по одной ноге

  constructor(token?: string, chatId?: string) {
    this.token = token || process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = chatId || process.env.TELEGRAM_CHAT_ID || '';
  }

  public setCredentials(token: string, chatId: string): void {
    this.token = token;
    this.chatId = chatId;
  }

  public isMuted(): boolean {
    return Date.now() < this.mutedUntil;
  }

  public mute(minutes: number): void {
    this.mutedUntil = Date.now() + minutes * 60 * 1000;
  }

  public async sendMessage(chatId: string, text: string, replyMarkup?: unknown): Promise<boolean> {
    if (!this.token) {
      console.log(`[Telegram (локальный лог)] В чат ${chatId}:\n${text}\n`);
      return false;
    }

    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: replyMarkup !== undefined ? replyMarkup : MAIN_MENU_KEYBOARD,
    };

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        // Fallback без Markdown, если была ошибка парсинга
        payload.text = text.replace(/[*_`]/g, '');
        delete payload.parse_mode;
        await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      return true;
    } catch (err) {
      console.error('[Telegram] Ошибка отправки сообщения:', err);
      return false;
    }
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
        signal: AbortSignal.timeout(6000),
      });
      return true;
    } catch {
      return false;
    }
  }


  public async sendDocument(
    chatId: string,
    filename: string,
    content: string | Buffer,
    caption?: string
  ): Promise<boolean> {
    if (!this.token) {
      console.log(`[Telegram (локальный лог)] Отправка документа ${filename} в чат ${chatId}`);
      return false;
    }

    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      const mimeType = filename.endsWith('.json') ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8';
      const blob = new Blob([content], { type: mimeType });
      formData.append('document', blob, filename);
      if (caption) {
        formData.append('caption', caption);
      }

      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(15000),
      });

      return res.ok;
    } catch (err) {
      console.error('[Telegram] Ошибка отправки документа:', err);
      return false;
    }
  }

  public async sendAlert(text: string, alertKey?: string, isCritical = false): Promise<boolean> {
    if (this.isMuted()) return false;
    const now = Date.now();

    if (alertKey) {
      const last = this.lastAlertTimes.get(alertKey) || 0;
      const cooldown = isCritical ? 2 * 60 * 1000 : this.alertCooldownMs;
      if (now - last < cooldown) {
        return false;
      }
      this.lastAlertTimes.set(alertKey, now);
    }

    if (this.chatId) {
      return this.sendMessage(this.chatId, text);
    }
    return false;
  }

  public async dispatchRiskAlerts(assessments: RiskAssessment[], symbol: string): Promise<void> {
    for (const a of assessments) {
      if (a.status === 'critical') {
        const msg = formatRiskAlert(a, symbol);
        await this.sendAlert(msg, `${symbol}_${a.legId}_critical`, true);
      } else if (a.status === 'warning') {
        const msg = formatRiskAlert(a, symbol);
        await this.sendAlert(msg, `${symbol}_${a.legId}_warning`, false);
      }
    }
  }

  public async dispatchSpikeAlert(spike: SpikeAlert): Promise<void> {
    const msg = formatSpikeAlert(spike);
    await this.sendAlert(msg, `${spike.symbol}_spike_${spike.windowMinutes}m`, true);
  }

  public startPolling(onHedgeUpdate?: (newHedge: ThreeLegHedge) => void): void {
    if (!this.token) {
      console.log('ℹ️ TELEGRAM_BOT_TOKEN не задан в .env. Бот работает в режиме консольного монитора.');
      return;
    }

    this.isPolling = true;
    console.log('🤖 Telegram Long-Polling запущен. Ожидание команд...');
    this.pollLoop(onHedgeUpdate);
  }

  public stopPolling(): void {
    this.isPolling = false;
  }

  private async pollLoop(onHedgeUpdate?: (newHedge: ThreeLegHedge) => void): Promise<void> {
    while (this.isPolling) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

        if (res.ok) {
          const data = (await res.json()) as {
            ok: boolean;
            result: Array<{
              update_id: number;
              message?: {
                chat: { id: number | string };
                text?: string;
              };
              callback_query?: {
                id: string;
                from: { id: number | string };
                message?: { chat: { id: number | string } };
                data?: string;
              };
            }>;
          };

          if (data.ok && Array.isArray(data.result)) {
            for (const upd of data.result) {
              this.lastUpdateId = upd.update_id;
              if (upd.message?.text) {
                await this.handleMessage(String(upd.message.chat.id), upd.message.text, onHedgeUpdate);
              } else if (upd.callback_query?.data && upd.callback_query?.message?.chat?.id) {
                await this.handleCallbackQuery(upd.callback_query, onHedgeUpdate);
              }
            }
          }
        }
      } catch (err) {
        // Пауза перед следующим опросом при ошибке соединения
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async handleCallbackQuery(
    cb: {
      id: string;
      message?: { chat: { id: number | string } };
      data?: string;
    },
    onHedgeUpdate?: (newHedge: ThreeLegHedge) => void
  ): Promise<void> {
    const chatId = String(cb.message?.chat.id);
    const data = cb.data || '';

    await this.answerCallbackQuery(cb.id, 'Принято!');

    if (data.startsWith('close_')) {
      const symbol = data.replace('close_', '');
      const reply = await deactivateHedgeOnchain(symbol);
      await this.sendMessage(chatId, reply);
      if (onHedgeUpdate) {
        const freshConfig = loadConfig();
        onHedgeUpdate(freshConfig.currentHedge);
      }
    } else if (data.startsWith('open_')) {
      const symbol = data.replace('open_', '');
      await this.sendMessage(chatId, `🔍 Проверяю ончейн-позиции для **${symbol}**...`);
      const reply = await activateHedgeOnchain(symbol);
      await this.sendMessage(chatId, reply);
      if (onHedgeUpdate) {
        const freshConfig = loadConfig();
        onHedgeUpdate(freshConfig.currentHedge);
      }
    }
  }

  private async handleMessage(
    chatId: string,
    text: string,
    onHedgeUpdate?: (newHedge: ThreeLegHedge) => void
  ): Promise<void> {
    const trimmed = text.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const config = loadConfig();

    if (!this.chatId) {
      this.chatId = chatId;
    }

    // 1. Быстрый роутинг кнопок фиксации входа и выхода
    if (trimmed.startsWith('➕ Внести вход')) {
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '+ INTC (Активна 🔥)', callback_data: 'open_INTC' },
            { text: '+ MSFT (28.10 🔥)', callback_data: 'open_MSFT' },
          ],
          [
            { text: '+ GOOGL (28.10 🔥)', callback_data: 'open_GOOGL' },
            { text: '+ AMZN (29.10 🔥)', callback_data: 'open_AMZN' },
          ],
          [
            { text: '+ AAPL (30.10 🔥)', callback_data: 'open_AAPL' },
            { text: '+ META (30.10 🔥)', callback_data: 'open_META' },
          ],
        ],
      };
      await this.sendMessage(
        chatId,
        [
          `➕ **ФИКСАЦИЯ ВХОДА В СВЯЗКУ (/o)**`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Бот автоматически опрашивает ончейн Robinhood и Arbitrum Core, считывая реальные объёмы, цены входа и ликвидации.`,
          ``,
          `💡 **Варианты команды:**`,
          `• Автоматически по ончейну: \`/o СИМВОЛ\` (например: \`/o INTC\`)`,
          `• С выбором кошелька: \`/o INTC w1\` или \`/o INTC w2\``,
          `• Вручную с количеством акций: \`/o INTC 452\``,
          `• Вручную с количеством и ценой: \`/o INTC 452 86.15\``,
          ``,
          `Или нажмите кнопку ниже для мгновенной ончейн-проверки:`,
        ].join('\n'),
        inlineKeyboard
      );
      return;
    }

    if (trimmed.startsWith('🛑 Внести выход')) {
      const active = getActiveHedges(config);
      if (active.length === 0) {
        await this.sendMessage(chatId, '❌ Нет активных связок для закрытия.');
        return;
      }
      const buttons = active.map((h) => [
        { text: `🛑 Закрыть ${h.symbol}`, callback_data: `close_${h.symbol}` },
      ]);
      await this.sendMessage(
        chatId,
        '🛑 **Какую открытую позицию вы закрыли на бирже?**\nНажмите кнопку для моментальной остановки сирены и записи PnL в журнал:',
        { inline_keyboard: buttons }
      );
      return;
    }

    // 2. Роутинг основных команд
    if (trimmed.startsWith('📊 Статус')) {
      const reply = await handleStatusCommand();
      await this.sendMessage(chatId, reply);
      return;
    }

    if (trimmed.startsWith('⚖️ Бридж')) {
      await this.sendMessage(chatId, '⏳ Опрашиваю ончейн-балансы Robinhood и Arbitrum Core...');
      const reply = await handleRebalanceCommand();
      await this.sendMessage(chatId, reply);
      return;
    }

    if (trimmed.startsWith('📈 Анализ входа')) {
      await this.sendMessage(chatId, '⏳ Сканирую стаканы рынков Lighter и балансы на вход...');
      const matrix = await handleMarketMatrixCommand('open');
      await this.sendMessage(chatId, matrix.topCardsText);
      await this.sendDocument(chatId, 'market_matrix_open.json', matrix.fileContent, '📊 Полная матрица входа (JSON)');
      return;
    }

    if (trimmed.startsWith('📉 Анализ выхода')) {
      await this.sendMessage(chatId, '⏳ Рассчитываю потери на закрытие маркетом по стакану...');
      const report = await handleActiveHedgesExitCommand();
      await this.sendMessage(chatId, report.text, report.inlineKeyboard);
      return;
    }

    switch (cmd) {
      case '/start':
      case '/help': {
        const help = [
          `👋 **Привет! Я бот дельта-нейтрального хеджирования и Hedge Ops терминал.**`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `🚀 **Управление связками и рынком:**`,
          `⚖️ \`/b [w1/w2]\` — расчёт ребалансировки депозитов и инструкция по бриджу 50/50`,
          `📈 \`/o\` — сканирование стаканов 27 рынков на вход (ТОП-5 + файл матрицы)`,
          `⚡️ \`/o [символ] [w1/w2]\` — ончейн-активация новой связки, мониторинг и запись в CSV`,
          `📉 \`/c\` — расчёт потерь на закрытие активных связок (100% и 50% по стакану)`,
          `🛑 \`/c [символ]\` — закрытие связки, остановка алертов/сирены и запись в CSV`,
          ``,
          `📊 **Мониторинг и аналитика:**`,
          `📊 \`/status\` — статус активных связок, дистанция до ликвидации и PnL`,
          `🌐 \`/markets\` — обзор рынков Robinhood & Polymarket и фандинга`,
          `🧮 \`/calc [символ] [маржа] [24h/7d]\` — расчет безопасного плеча под волатильность`,
          `💸 \`/funding [символ]\` — сравнение ставок фандинга`,
          `🎯 \`/select [символ]\` — переключить активный рынок недели`,
          `🔄 \`/sync\` — стелс-синхронизация позиций с кошельков`,
          `👛 \`/poly [адрес]\` — привязать кошелек Polymarket`,
          `🔇 \`/mute [минуты]\` — временная пауза алертов`,
          ``,
          `💡 Все расчеты производятся со 100% Anti-Sybil защитой.`,
        ].join('\n');
        await this.sendMessage(chatId, help);
        break;
      }

      case '/sync': {
        const reply = await handleSyncCommand(async (progressText) => {
          await this.sendMessage(chatId, progressText);
        });
        await this.sendMessage(chatId, reply);
        if (onHedgeUpdate) {
          const freshConfig = loadConfig();
          onHedgeUpdate(freshConfig.currentHedge);
        }
        break;
      }

      case '/status': {
        const symbolArg = args[0]?.toUpperCase().replace('-USD', '');
        let targetHedge: ThreeLegHedge | undefined;
        if (symbolArg) {
          const active = getActiveHedges(config);
          targetHedge = active.find((h) => h.symbol.toUpperCase() === symbolArg);
          if (!targetHedge) {
            await this.sendMessage(chatId, `❌ Связка для **${symbolArg}** не найдена в активных конфигурациях.`);
            break;
          }
        }
        const reply = await handleStatusCommand(targetHedge);
        await this.sendMessage(chatId, reply);
        break;
      }

      case '/markets': {
        const reply = await handleMarketsCommand(10);
        await this.sendMessage(chatId, reply);
        break;
      }

      case '/calc': {
        const reply = handleCalcCommand(args);
        await this.sendMessage(chatId, reply);
        break;
      }

      case '/funding': {
        const symbol = args[0] || config.currentHedge.symbol;
        const reply = await handleFundingCommand(symbol);
        await this.sendMessage(chatId, reply);
        break;
      }

      case '/select': {
        if (!args[0]) {
          await this.sendMessage(chatId, '❌ Укажите символ актива. Пример: `/select NVDA`');
          return;
        }
        const newSym = args[0].toUpperCase().replace('-USD', '');
        const updated = { ...config.currentHedge, symbol: newSym, updatedAt: Date.now() };
        saveHedgeConfig(updated);
        if (onHedgeUpdate) onHedgeUpdate(updated);
        await this.sendMessage(
          chatId,
          `✅ **Активный рынок переключен на: ${newSym}**\nПроверьте котировки через \`/status\` или рассчитайте плечо через \`/calc ${newSym}\`.`
        );
        break;
      }

      case '/poly': {
        const reply = handlePolyWalletCommand(args[0]);
        await this.sendMessage(chatId, reply);
        break;
      }

      case '/b': {
        await this.sendMessage(chatId, '⏳ Опрашиваю ончейн-балансы Robinhood и Arbitrum Core...');
        const reply = await handleRebalanceCommand(args[0]);
        await this.sendMessage(chatId, reply);
        break;
      }

      case '/o': {
        const firstArgLower = args[0]?.toLowerCase();
        const isWalletOnly = firstArgLower === 'w1' || firstArgLower === 'w2' || firstArgLower === 'all';

        if (args.length > 0 && !isWalletOnly) {
          const parsed = parseOpenCommandArgs(args);
          const ticker = parsed.symbol || args[0].toUpperCase();
          await this.sendMessage(chatId, `🔍 Проверяю ончейн-позиции для **${ticker}**...`);
          const reply = await activateHedgeOnchain(
            ticker,
            parsed.targetWallet,
            parsed.manualSize,
            parsed.manualPrice,
            parsed.manualLeverage
          );
          await this.sendMessage(chatId, reply);
          if (onHedgeUpdate) {
            const freshConfig = loadConfig();
            onHedgeUpdate(freshConfig.currentHedge);
          }
        } else {
          // /o без аргументов или /o w1 / /o w2 / /o all: сканирование стаканов рынков на вход
          const targetWallet = isWalletOnly ? (firstArgLower as 'w1' | 'w2' | 'all') : undefined;
          await this.sendMessage(chatId, '⏳ Сканирую ончейн-балансы и стаканы рынков Lighter на вход...');
          const matrix = await handleMarketMatrixCommand('open', targetWallet);
          await this.sendMessage(chatId, matrix.topCardsText);
          await this.sendDocument(chatId, 'market_matrix_open.json', matrix.fileContent, '📊 Полная матрица входа (JSON)');
        }
        break;
      }

      case '/c':
      case '/close':
      case '/deactivate': {
        if (args.length > 0) {
          const parsed = parseCloseCommandArgs(args);
          const ticker = parsed.symbol || args[0].toUpperCase();
          const reply = await deactivateHedgeOnchain(ticker, parsed.exitPrice);
          await this.sendMessage(chatId, reply);
          if (onHedgeUpdate) {
            const freshConfig = loadConfig();
            onHedgeUpdate(freshConfig.currentHedge);
          }
        } else {
          // /c без аргументов: расчет закрытия маркетом активных связок
          await this.sendMessage(chatId, '⏳ Рассчитываю потери на закрытие маркетом по стакану...');
          const report = await handleActiveHedgesExitCommand();
          await this.sendMessage(chatId, report.text, report.inlineKeyboard);
        }
        break;
      }

      case '/mute': {
        const mins = parseInt(args[0] || '30', 10);
        this.mute(mins);
        await this.sendMessage(chatId, `🔇 Уведомления заглушены на **${mins} минут**.`);
        break;
      }

      default: {
        await this.sendMessage(chatId, 'Неизвестная команда. Введите `/help` для списка возможностей.');
        break;
      }
    }
  }
}
