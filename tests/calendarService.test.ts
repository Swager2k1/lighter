import test from 'node:test';
import assert from 'node:assert/strict';
import { getEarningsInfo } from '../src/services/calendarService.js';

test('calendarService correctly returns earnings info for MSFT', () => {
  const info = getEarningsInfo('MSFT');
  assert.equal(info.hasEarnings, true);
  assert.equal(info.boost, true);
  assert.equal(info.date, '28.10.2026');
  assert.ok(info.daysUntilEarnings >= 0);
});

test('calendarService correctly returns earnings info for COIN', () => {
  const info = getEarningsInfo('COIN');
  assert.equal(info.hasEarnings, true);
  assert.equal(info.boost, true);
  assert.equal(info.date, '29.10.2026');
  assert.ok(info.daysUntilEarnings >= 0);
});

test('calendarService returns fallback for assets without earnings', () => {
  const info = getEarningsInfo('TSM');
  assert.equal(info.hasEarnings, false);
  assert.equal(info.boost, false);
  assert.equal(info.riskText, '🟢 Безопасно (нет отчета)');
});
