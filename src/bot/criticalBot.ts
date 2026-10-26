import { RiskAssessment } from '../types.js';
import { deactivateHedge } from '../config.js';

export interface CriticalLegState {
  lastAlertedStep: number | null; // Последний пройденный порог: 2.50, 2.25, 2.00, 1.75
  isInPanic: boolean;             // Флаг нахождения в критической зоне сирены (<= 1.50%)
  lastPanicAlertTime: number;     // Таймстемп последнего паник-алерта (для выдержки интервала)
}

export class CriticalAlertBotService {
  private token: string;
  private chatId: string;
  private isPolling = false;
  private lastUpdateId = 0;

  // Пороги и настройки
  public readonly startThresholdPct = 2.50;
  public readonly stepSizePct = 0.25;
  public readonly panicThresholdPct = 1.50;
  public readonly recoveryThresholdPct = 2.75;
  public readonly panicCooldownMs = 14000; // Раз в ~15 секунд в зоне сирены

  // Состояние по каждой ноге: ключ `${symbol}_${legId}`
  private legStates: Map<string, CriticalLegState> = new Map();

  constructor(token?: string, chatId?: string) {
    this.token = token || process.env.CRITICAL_TELEGRAM_BOT_TOKEN || '';
    this.chatId = chatId || process.env.TELEGRAM_CHAT_ID || '';
  }

  public isConfigured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  public getLegState(key: string): CriticalLegState {
    return this.legStates.get(key) || {
      lastAlertedStep: null,
      isInPanic: false,
      lastPanicAlertTime: 0,
    };
  }

  public setLegState(key: string, state: CriticalLegState): void {
    this.legStates.set(key, state);
  }

  /**
   * Отправка сообщения со звуком (disable_notification = false)
   */
  public async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.token) {
      console.log(`[Critical Bot (локальный лог)] В чат ${chatId}:\n${text}\n`);
      return false;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_notification: false, // ГРОМКОЕ УВЕДОМЛЕНИЕ СО ЗВУКОМ!
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        // Fallback на чистый текст без тегов
        await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.replace(/<[^>]*>/g, ''),
            disable_notification: false,
            disable_web_page_preview: true,
          }),
        });
      }

      return true;
    } catch (err) {
      console.error('[Critical Bot] Ошибка отправки сообщения:', err);
      return false;
    }
  }

  /**
   * Анализ рисков и диспетчеризация критических уведомлений
   */
  public async dispatchCriticalAlerts(assessments: RiskAssessment[], symbol: string): Promise<void> {
    if (!this.chatId || !this.token) return;

    for (const leg of assessments) {
      const distance = leg.distanceToLiqPct;
      const key = `${symbol}_${leg.legId}`;
      const state = this.getLegState(key);
      const now = Date.now();

      // ─── 1. ЗОНА ПАНИКИ / СИРЕНА (<= 1.50%) ───
      if (distance <= this.panicThresholdPct) {
        state.isInPanic = true;
        if (now - state.lastPanicAlertTime >= this.panicCooldownMs) {
          const msg = this.formatPanicAlert(leg, symbol);
          await this.sendMessage(this.chatId, msg);
          state.lastPanicAlertTime = now;
          state.lastAlertedStep = this.panicThresholdPct;
          this.setLegState(key, state);
        }
        continue;
      }

      // Если вышли из паники обратно выше 1.50%, но ниже 2.50%
      if (state.isInPanic && distance > this.panicThresholdPct) {
        state.isInPanic = false;
        const msg = [
          `🟢 **[КРИТИЧЕСКИЙ БОТ: ВЫХОД ИЗ ЗОНЫ СИРЕНЫ]**`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Запас хода по **${symbol}** (${leg.name}) поднялся до **${distance.toFixed(2)}%** (выше 1.50%).`,
          `Непрерывная сирена отключена. Мониторинг продолжается с шагом 0.25%.`,
        ].join('\n');
        await this.sendMessage(this.chatId, msg);
        // Выставляем порог под текущий уровень
        state.lastAlertedStep = Math.max(1.75, Math.ceil(distance / this.stepSizePct - 0.0001) * this.stepSizePct);
        this.setLegState(key, state);
        continue;
      }

      // ─── 2. ШАГОВАЯ ЗОНА ОПАСНОСТИ (1.50% < distance <= 2.50%) ───
      if (distance <= this.startThresholdPct) {
        // Первый вход в зону риска (<= 2.50%)
        if (state.lastAlertedStep === null) {
          const msg = this.formatWarningStepAlert(leg, symbol, 2.50);
          await this.sendMessage(this.chatId, msg);
          state.lastAlertedStep = 2.50;
          this.setLegState(key, state);
          continue;
        }

        // Проверка пробития следующего шага вниз (на 0.25% ниже предыдущего)
        const nextStepBoundary = state.lastAlertedStep - this.stepSizePct;
        if (distance <= nextStepBoundary) {
          // Определяем пройденный шаг (2.25, 2.00, 1.75...)
          const crossedStep = Math.max(
            1.75,
            Math.ceil(distance / this.stepSizePct - 0.0001) * this.stepSizePct
          );
          const msg = this.formatWarningStepAlert(leg, symbol, crossedStep);
          await this.sendMessage(this.chatId, msg);
          state.lastAlertedStep = crossedStep;
          this.setLegState(key, state);
          continue;
        }

        // Если цена колеблется внутри того же 0.25% диапазона — ничего не шлем
        continue;
      }

      // ─── 3. БЕЗОПАСНАЯ ЗОНА (> 2.50%) ───
      if (distance >= this.recoveryThresholdPct) {
        if (state.lastAlertedStep !== null || state.isInPanic) {
          const msg = [
            `🟢 **[КРИТИЧЕСКИЙ БОТ: БЕЗОПАСНАЯ ЗОНА]**`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Запас хода по **${symbol}** (${leg.name}) восстановился до **${distance.toFixed(2)}%** (выше 2.50%).`,
            `Позиция вне зоны непосредственного риска ликвидации.`,
          ].join('\n');
          await this.sendMessage(this.chatId, msg);
          state.lastAlertedStep = null;
          state.isInPanic = false;
          this.setLegState(key, state);
        }
      }
    }
  }

  private formatWarningStepAlert(leg: RiskAssessment, symbol: string, level: number): string {
    const sideName = leg.side === 'long' ? '📈 LONG' : '📉 SHORT';
    return [
      `⚠️🚨 <b>[КРИТИЧЕСКИЙ БОТ: ВНИМАНИЕ]</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `• Актив: <b>${symbol}</b>`,
      `• Позиция: <b>${leg.name}</b> ${sideName}`,
      `• Текущая цена: <b>$${leg.currentPrice.toFixed(2)}</b>`,
      `• Цена ликвидации: <b>$${leg.liquidationPrice.toFixed(2)}</b>`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⚠️ <b>ОСТАВШИЙСЯ ЗАПАС ХОДА: ${leg.distanceToLiqPct.toFixed(2)}% ($${leg.distanceToLiqUsd.toFixed(2)})</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `• Порог оповещения: <b>${level.toFixed(2)}%</b>`,
      `• Маржа позиции: <b>$${leg.margin}</b>`,
      ``,
      `🔔 Следующее уведомление придет при падении еще на 0.25% (на уровне <b>${(level - 0.25).toFixed(2)}%</b>).`,
      `⚠️ При достижении &lt;= 1.50% включится постоянная звуковая сирена!`,
    ].join('\n');
  }

  private formatPanicAlert(leg: RiskAssessment, symbol: string): string {
    const sideName = leg.side === 'long' ? '📈 LONG' : '📉 SHORT';
    return [
      `🚨🚨🚨 <b>КРИТИЧЕСКАЯ ТРЕВОГА: СРОЧНО ЗАКРОЙТЕ ПОЗИЦИЮ!</b> 🚨🚨🚨`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `• Актив: <b>${symbol}</b>`,
      `• Позиция: <b>${leg.name}</b> ${sideName}`,
      `• Текущая цена: <b>$${leg.currentPrice.toFixed(2)}</b>`,
      `• Ликвидация: <b>$${leg.liquidationPrice.toFixed(2)}</b>`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🚨 <b>ОСТАВШИЙСЯ ЗАПАС ХОДА: ${leg.distanceToLiqPct.toFixed(2)}% ($${leg.distanceToLiqUsd.toFixed(2)})</b> 🚨`,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `• Маржа под угрозой потери: <b>$${leg.margin}</b>`,
      ``,
      `⚡️ <b>НЕМЕДЛЕННО ЗАКРОЙТЕ СВЯЗКУ НА БИРЖЕ ИЛИ ДОЛЕЙТЕ МАРЖУ!</b>`,
      `🔔 Это экстренное сообщение будет повторяться каждые 15 секунд со звуком, пока позиция не будет в безопасности!`,
    ].join('\n');
  }

  public startPolling(getStatusReport?: () => Promise<string>): void {
    if (!this.token) return;
    this.isPolling = true;
    console.log('🚨 Critical Alert Bot Long-Polling запущен...');
    this.pollLoop(getStatusReport);
  }

  public stopPolling(): void {
    this.isPolling = false;
  }

  private async pollLoop(getStatusReport?: () => Promise<string>): Promise<void> {
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
            }>;
          };
          if (data.ok && Array.isArray(data.result)) {
            for (const upd of data.result) {
              this.lastUpdateId = upd.update_id;
              if (upd.message?.text) {
                await this.handleIncomingMessage(String(upd.message.chat.id), upd.message.text, getStatusReport);
              }
            }
          }
        }
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async handleIncomingMessage(
    chatId: string,
    text: string,
    getStatusReport?: () => Promise<string>
  ): Promise<void> {
    const cmd = text.trim().toLowerCase().split(/\s+/)[0];

    switch (cmd) {
      case '/start':
      case '/help': {
        const help = [
          `🚨 **Привет! Я бот КРИТИЧЕСКИХ уведомлений о ликвидации (RH_CRITICAL).**`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Моя задача — разбудить вас громким звуком при опасном приближении к ликвидации:`,
          `• ⚠️ **Первое предупреждение:** при остатке хода <= **2.50%**`,
          `• 📉 **Шаговые уведомления:** при падении каждые **0.25%** (2.25%, 2.00%, 1.75%)`,
          `• 🚨 **РЕЖИМ СИРЕНЫ:** при остатке <= **1.50%** — непрерывные алерты каждые 15 секунд со звуком!`,
          ``,
          `Команды:`,
          `🔔 \`/test\` — отправить тестовый громкий сигнал тревоги`,
          `📊 \`/status\` — статус позиций и минимальный запас хода`,
        ].join('\n');
        await this.sendMessage(chatId, help);
        break;
      }

      case '/test': {
        const testMsg = [
          `🔊 **ТЕСТОВЫЙ ЗВУКОВОЙ СИГНАЛ ТРЕВОГИ!**`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Канал критических уведомлений RH_CRITICAL работает штатно.`,
          `Убедитесь, что для этого чата в Telegram **включен звук на максимум**.`,
        ].join('\n');
        await this.sendMessage(chatId, testMsg);
        break;
      }

      case '/status': {
        if (getStatusReport) {
          const status = await getStatusReport();
          await this.sendMessage(chatId, status);
        } else {
          await this.sendMessage(chatId, '✅ Система мониторинга активна. Критических угроз на данный момент нет.');
        }
        break;
      }

      case '/close':
      case '/stop': {
        const parts = text.trim().split(/\s+/);
        if (!parts[1]) {
          await this.sendMessage(chatId, '❌ Укажите символ актива. Пример: `/close ORCL`');
          break;
        }
        const sym = parts[1].toUpperCase().replace('-USD', '');
        const success = deactivateHedge(sym);
        if (success) {
          await this.sendMessage(
            chatId,
            `🛑 **КРИТИЧЕСКИЙ БОТ: Мониторинг связки ${sym} остановлен.**\nСирена и алерты по этой позиции отключены.`
          );
        } else {
          await this.sendMessage(chatId, `⚠️ Связка **${sym}** не найдена в активных конфигурациях.`);
        }
        break;
      }

      default: {
        await this.sendMessage(chatId, 'Введите `/help` или `/test` для проверки звука. Для отключения связки: `/close [символ]`.');
        break;
      }
    }
  }
}
