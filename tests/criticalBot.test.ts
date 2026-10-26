import test from 'node:test';
import assert from 'node:assert';
import { CriticalAlertBotService } from '../src/bot/criticalBot.js';
import { RiskAssessment } from '../src/types.js';

class MockCriticalAlertBotService extends CriticalAlertBotService {
  public sentMessages: string[] = [];

  constructor() {
    super('mock-token', 'mock-chat-id');
  }

  public override async sendMessage(chatId: string, text: string): Promise<boolean> {
    this.sentMessages.push(text);
    return true;
  }
}

function makeMockLeg(distancePct: number): RiskAssessment {
  return {
    legId: 'rh_w1_long',
    name: 'Robinhood 1 (Long)',
    venue: 'lighter',
    side: 'long',
    margin: 1000,
    entryPrice: 100,
    currentPrice: 90,
    liquidationPrice: 85,
    distanceToLiqPct: distancePct,
    distanceToLiqUsd: 5,
    unrealizedPnl: -10,
    status: distancePct <= 2.5 ? 'critical' : 'safe',
  };
}

test('CriticalAlertBotService - no alert when distance > 2.5%', async () => {
  const bot = new MockCriticalAlertBotService();
  await bot.dispatchCriticalAlerts([makeMockLeg(3.5)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 0, 'Should not send alerts when buffer is safe');
});

test('CriticalAlertBotService - sends alert at entry <= 2.5% and steps by 0.25%', async () => {
  const bot = new MockCriticalAlertBotService();

  // 1. Вход в зону риска: 2.45% (порог 2.50%)
  await bot.dispatchCriticalAlerts([makeMockLeg(2.45)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 1, 'Should trigger first 2.50% alert');
  assert.ok(bot.sentMessages[0].includes('2.45%'), 'Message includes current distance');
  assert.ok(bot.sentMessages[0].includes('2.50%'), 'Message includes threshold');

  // 2. Движение внутри диапазона: 2.38% (не достигло 2.25%) -> тишина
  await bot.dispatchCriticalAlerts([makeMockLeg(2.38)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 1, 'Should NOT spam within same 0.25% step');

  // 3. Падение до 2.22% (пробит порог 2.25%) -> алерт
  await bot.dispatchCriticalAlerts([makeMockLeg(2.22)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 2, 'Should trigger 2.25% step alert');
  assert.ok(bot.sentMessages[1].includes('2.25%'), 'Message includes 2.25% step');

  // 4. Падение до 1.95% (пробит порог 2.00%) -> алерт
  await bot.dispatchCriticalAlerts([makeMockLeg(1.95)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 3, 'Should trigger 2.00% step alert');
  assert.ok(bot.sentMessages[2].includes('2.00%'), 'Message includes 2.00% step');

  // 5. Падение до 1.70% (пробит порог 1.75%) -> алерт
  await bot.dispatchCriticalAlerts([makeMockLeg(1.70)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 4, 'Should trigger 1.75% step alert');
  assert.ok(bot.sentMessages[3].includes('1.75%'), 'Message includes 1.75% step');
});

test('CriticalAlertBotService - siren mode when <= 1.5%', async () => {
  const bot = new MockCriticalAlertBotService();

  // Падение в зону сирены: 1.45%
  await bot.dispatchCriticalAlerts([makeMockLeg(1.45)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 1, 'Should trigger panic siren');
  assert.ok(bot.sentMessages[0].includes('КРИТИЧЕСКАЯ ТРЕВОГА'), 'Contains emergency alarm header');
  assert.ok(bot.sentMessages[0].includes('1.45%'), 'Contains distance');

  // Сразу следующий цикл через 1 секунду (кулдаун 14 сек еще активен) -> не дублирует
  await bot.dispatchCriticalAlerts([makeMockLeg(1.42)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 1, 'Should rate limit within panic cooldown');

  // Имитируем прошествие 15 секунд
  const state = bot.getLegState('AAPL_rh_w1_long');
  state.lastPanicAlertTime = Date.now() - 15000;
  bot.setLegState('AAPL_rh_w1_long', state);

  // Следующий цикл после кулдауна -> сирена бьет тревогу снова!
  await bot.dispatchCriticalAlerts([makeMockLeg(1.39)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 2, 'Should send repeated siren alert after cooldown');
  assert.ok(bot.sentMessages[1].includes('1.39%'), 'Contains new distance');
});

test('CriticalAlertBotService - recovery from panic and safe zone reset', async () => {
  const bot = new MockCriticalAlertBotService();

  // 1. Вошли в панику
  await bot.dispatchCriticalAlerts([makeMockLeg(1.40)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 1);

  // 2. Отскок до 1.85% (выход из сирены)
  await bot.dispatchCriticalAlerts([makeMockLeg(1.85)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 2, 'Should notify about exit from siren');
  assert.ok(bot.sentMessages[1].includes('ВЫХОД ИЗ ЗОНЫ СИРЕНЫ'));

  // 3. Отскок в безопасную зону 2.80% (выше 2.75%)
  await bot.dispatchCriticalAlerts([makeMockLeg(2.80)], 'AAPL');
  assert.strictEqual(bot.sentMessages.length, 3, 'Should notify about safe zone');
  assert.ok(bot.sentMessages[2].includes('БЕЗОПАСНАЯ ЗОНА'));

  // Проверяем сброс состояния
  const state = bot.getLegState('AAPL_rh_w1_long');
  assert.strictEqual(state.lastAlertedStep, null, 'State step should be reset');
  assert.strictEqual(state.isInPanic, false, 'Panic flag should be reset');
});
