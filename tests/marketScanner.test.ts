import test from 'node:test';
import assert from 'node:assert';
import { findCommonMarkets, getMarketInfo } from '../src/services/marketScanner.js';

test('findCommonMarkets discovers overlapping markets', async () => {
  const common = await findCommonMarkets();
  assert.ok(Array.isArray(common), 'Should return array');
  assert.ok(common.length >= 10, `Should find at least 10 markets, found ${common.length}`);
  assert.ok(common.includes('TSM'), 'Should include TSM');
  assert.ok(common.includes('NVDA'), 'Should include NVDA');
  assert.ok(common.includes('BTC'), 'Should include BTC');
});

test('getMarketInfo returns comparative pricing for TSM', async () => {
  const info = await getMarketInfo('TSM');
  assert.ok(info !== null, 'MarketInfo for TSM should not be null');
  assert.strictEqual(info.symbol, 'TSM');
  assert.ok(info.lighterMarkPrice > 0, 'Lighter mark price should be > 0');
  assert.ok(info.polymarketMarkPrice > 0, 'Polymarket mark price should be > 0');
  // Both prices should be within reasonable proximity (e.g. within 2% of each other)
  const diffPct = Math.abs(info.priceSpreadPct);
  assert.ok(diffPct < 2.0, `Price spread between venues should be tight, got ${diffPct}%`);
});
