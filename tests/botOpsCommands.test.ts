import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRebalanceCommand, handleActiveHedgesExitCommand } from '../src/bot/handlers.js';
import { MAIN_MENU_KEYBOARD } from '../src/bot/telegram.js';

test('handleRebalanceCommand produces valid output text for configured wallets', async () => {
  const reply = await handleRebalanceCommand();
  assert.ok(reply.includes('РЕБАЛАНСИРОВКА'));
  assert.ok(reply.includes('Robinhood'));
  assert.ok(reply.includes('Arbitrum'));
});

test('handleRebalanceCommand with target wallet w1 focuses on W1', async () => {
  const reply = await handleRebalanceCommand('w1');
  assert.ok(reply.includes('Wallet 1 (W1)'));
});

test('exit report walks each live quantity and suppresses the aggregate when depth is short', async (t) => {
  // 1. Сценарий: все связки закрыты
  const emptyReport = await handleActiveHedgesExitCommand({ hedges: [] } as any);
  assert.ok(typeof emptyReport.text === 'string');
  assert.ok(emptyReport.text.includes('Нет активных открытых позиций'));

  // 2. Сценарий: есть активная связка
  const mockConfig: any = {
    defaultSymbol: 'TSM',
    pollIntervalMs: 15000,
    thresholds: {
      warningBufferPct: 5,
      criticalBufferPct: 2.5,
      spike1mPct: 1,
      spike3mPct: 1.8,
      spike5mPct: 2.5,
    },
    wallets: { robinhoodWallet1: '0xWallet1' },
    telegram: { botToken: '', chatId: '' },
    hedges: [
      {
        symbol: 'TSM',
        walletSlot: 'w1',
        active: true,
        legs: [
          {
            id: 'rh_tsm_short',
            name: 'Wallet 1 (W1) (Short)',
            venue: 'lighter',
            side: 'short',
            margin: 100,
            entryPrice: 400,
            leverage: 7,
            size: 1,
            liquidationPrice: 450,
          },
          {
            id: 'core_tsm_long',
            name: 'Lighter Core (Wallet 1 (W1)) (Long)',
            venue: 'lighter',
            side: 'long',
            margin: 100,
            entryPrice: 400,
            leverage: 7,
            size: 1,
            liquidationPrice: 350,
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };

  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const rh = input.includes('api.rh.lighter');
    return Response.json(input.includes('/account?') ? { accounts: [{
      index: rh ? 1 : 2,
      positions: [{ symbol: 'TSM', market_id: 0, position: rh ? '1.0' : '2.0', sign: rh ? -1 : 1, avg_entry_price: '100' }],
    }] } : {
      bids: [{ price: '98', size: '1' }],
      asks: [{ price: '106', size: '2' }, { price: '104', size: '0.5' }],
    });
  });
  const reportWithActive = await handleActiveHedgesExitCommand(mockConfig);
  assert.ok(typeof reportWithActive.text === 'string');
  assert.ok(reportWithActive.text.includes('АНАЛИЗ ВЫХОДА ИЗ АКТИВНЫХ ПОЗИЦИЙ'));
  assert.ok(reportWithActive.text.includes('Полное закрытие (100%)'));
  assert.ok(reportWithActive.text.includes('Половина позиции (50%)'));
  assert.match(reportWithActive.text, /Core: недостаточно доступной глубины для 2 TSM/);
  assert.match(reportWithActive.text, /RH: 0.5 по средней \$104.00000/);
  assert.equal(reportWithActive.text.match(/PnL оставшегося объёма/g)?.length, 1);
  assert.ok(reportWithActive.inlineKeyboard !== undefined);
  assert.ok(Array.isArray(reportWithActive.inlineKeyboard.inline_keyboard));
  assert.ok(reportWithActive.inlineKeyboard.inline_keyboard.length > 0);
  assert.ok(reportWithActive.inlineKeyboard.inline_keyboard[0][0].callback_data.startsWith('close_'));
});

test('MAIN_MENU_KEYBOARD contains compact symmetric buttons with commands', () => {
  assert.equal(MAIN_MENU_KEYBOARD.keyboard.length, 3);
  assert.equal(MAIN_MENU_KEYBOARD.keyboard[0][0].text, '📊 Статус (/status)');
  assert.equal(MAIN_MENU_KEYBOARD.keyboard[0][1].text, '⚖️ Бридж (/b)');
  assert.equal(MAIN_MENU_KEYBOARD.keyboard[1][0].text, '📈 Анализ входа (/o)');
  assert.equal(MAIN_MENU_KEYBOARD.keyboard[1][1].text, '➕ Внести вход (/o)');
  assert.equal(MAIN_MENU_KEYBOARD.keyboard[2][0].text, '📉 Анализ выхода (/c)');
  assert.equal(MAIN_MENU_KEYBOARD.keyboard[2][1].text, '🛑 Внести выход (/c)');
});

