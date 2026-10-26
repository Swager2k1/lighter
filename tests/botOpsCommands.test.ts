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

test('handleActiveHedgesExitCommand returns report and inline keyboard buttons for active hedges', async () => {
  const report = await handleActiveHedgesExitCommand();
  assert.ok(typeof report.text === 'string');
  assert.ok(report.text.includes('АНАЛИЗ ВЫХОДА ИЗ АКТИВНЫХ ПОЗИЦИЙ'));
  assert.ok(report.text.includes('Полное закрытие (100%)'));
  assert.ok(report.text.includes('Половина позиции (50%)'));
  assert.ok(report.inlineKeyboard !== undefined);
  assert.ok(Array.isArray(report.inlineKeyboard.inline_keyboard));
  assert.ok(report.inlineKeyboard.inline_keyboard.length > 0);
  assert.ok(report.inlineKeyboard.inline_keyboard[0][0].callback_data.startsWith('close_'));
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

