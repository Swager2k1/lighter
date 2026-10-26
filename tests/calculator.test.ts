import test from 'node:test';
import assert from 'node:assert';
import { calculateSafeLeverage, getAssetVolatility } from '../src/services/calculator.js';

test('getAssetVolatility returns correct historical volatility', () => {
  assert.strictEqual(getAssetVolatility('TSM'), 0.34);
  assert.strictEqual(getAssetVolatility('NVDA'), 0.52);
  assert.strictEqual(getAssetVolatility('AAPL'), 0.22);
  assert.strictEqual(getAssetVolatility('UNKNOWN'), 0.35);
});

test('calculateSafeLeverage for TSM 24h horizon recommends 6x', () => {
  const rec = calculateSafeLeverage('TSM', 1200, '24h');
  assert.strictEqual(rec.symbol, 'TSM');
  assert.strictEqual(rec.timeframe, '24h');
  assert.ok(rec.recommendedLeverage >= 6, `Should recommend at least 6x for 24h, got ${rec.recommendedLeverage}x`);
  assert.ok(rec.distanceToLiqPct >= 10.0, 'Distance to liq should be >= 10%');

  // Проверка баланса ног: 1200 Long = 840 Short RH + 360 Short Poly
  assert.strictEqual(rec.split.leg1RobinhoodLong.margin, 1200);
  assert.strictEqual(rec.split.leg2RobinhoodShort.margin, 840);
  assert.strictEqual(rec.split.leg3PolymarketShort.margin, 360);
  assert.strictEqual(
    rec.split.leg2RobinhoodShort.margin + rec.split.leg3PolymarketShort.margin,
    rec.split.leg1RobinhoodLong.margin
  );
});

test('calculateSafeLeverage for TSM 7d horizon is more conservative', () => {
  const rec7d = calculateSafeLeverage('TSM', 1200, '7d');
  assert.strictEqual(rec7d.timeframe, '7d');
  // На 7 дней плечо должно быть консервативнее (<= 5x)
  assert.ok(
    rec7d.recommendedLeverage <= 5,
    `On 7d horizon, recommended leverage should be <= 5x, got ${rec7d.recommendedLeverage}x`
  );
  assert.ok(rec7d.distanceToLiqPct >= 14.0, '7d distance to liq should be >= 14%');
});
