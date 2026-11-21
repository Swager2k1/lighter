import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMarginAndLeverage } from '../src/services/positionSyncService.js';

test('computeMarginAndLeverage prefers IMF over tiny/wrong account collateral (prevents 422x)', () => {
  const result = computeMarginAndLeverage({
    size: 139.3,
    entryPrice: 117.62,
    accountCollateral: 38.81,
    initialMarginFraction: 14.29,
  });

  assert.ok(result.leverage >= 6 && result.leverage <= 8, `leverage should be ~7x, got ${result.leverage}`);
  assert.ok(result.margin > 2000, `margin should be ~notional/7, got ${result.margin}`);
});

test('computeMarginAndLeverage uses allocatedMargin when present', () => {
  const result = computeMarginAndLeverage({
    size: 100,
    entryPrice: 100,
    allocatedMargin: 1429,
    initialMarginFraction: 14.29,
    accountCollateral: 5000,
  });

  assert.equal(result.margin, 1429);
  assert.ok(Math.abs(result.leverage - 10000 / 1429) < 0.05);
});

test('computeMarginAndLeverage falls back to 7x when no onchain margin signals', () => {
  const result = computeMarginAndLeverage({
    size: 10,
    entryPrice: 100,
  });

  assert.equal(result.leverage, 7);
  assert.equal(result.margin, Math.round(1000 / 7));
});
