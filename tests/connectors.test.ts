import test from 'node:test';
import assert from 'node:assert';
import { fetchLighterTicker, getLighterMarketId } from '../src/connectors/lighter.js';
import { fetchPolymarketTicker, fetchPolymarketInstruments } from '../src/connectors/polymarket.js';
import { readLighterAccount } from '../src/connectors/lighter.js';
import { calculateEntryFriction } from '../src/services/positionSyncService.js';

test('SNDK entry basis agrees with the 16 fills despite rounded account prices', async (t) => {
  const core = { market_id: 11649, symbol: 'SNDK', position: '699.0000', sign: 1, avg_entry_price: '85.24',
    position_value: '59526.840000', unrealized_pnl: '-56.404178' };
  const rh = { ...core, market_id: 4110, sign: -1, avg_entry_price: '85.15',
    position_value: '59498.880000', unrealized_pnl: '20.970000' };
  const rows = [core, rh, { ...core, unrealized_pnl: '' }, { ...core, unrealized_pnl: '999999' }];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ accounts: [{ positions: [rows.shift()] }] }));
  const read = async () => (await readLighterAccount('W1', 'arb')).positions[0];
  const buy = await read();
  const sell = await read();
  assert.ok(Math.abs(buy.entryPrice * 699 - 59583.244178) < 1e-7);
  assert.equal(sell.entryPrice, 85.15);
  assert.deepEqual(calculateEntryFriction({ buyPrice: buy.entryPrice, sellPrice: sell.entryPrice,
    size: 699, notional: 59519.85 }), { frictionUsd: 63.39, frictionPct: 0.107 });
  for (let i = 0; i < 2; i++) {
    const fallback = await read();
    assert.equal(fallback.entryPrice, 85.24);
    assert.equal(fallback.entryPriceRounded, true);
  }
});

test('Lighter connector fetches TSM ticker', async () => {
  const marketId = await getLighterMarketId('TSM');
  assert.ok(marketId !== null, 'MarketId for TSM should be found');
  assert.strictEqual(typeof marketId, 'number');

  const ticker = await fetchLighterTicker('TSM');
  assert.ok(ticker !== null, 'Ticker for TSM should not be null');
  assert.strictEqual(ticker.symbol, 'TSM');
  assert.ok(ticker.markPrice > 0, 'Mark price should be positive');
  assert.strictEqual(ticker.mmr, 0.06, 'Lighter MMR should be 6.0%');
});

test('Polymarket connector fetches TSM ticker', async () => {
  const instruments = await fetchPolymarketInstruments();
  assert.ok(instruments.size > 0, 'Should load instruments list');
  assert.ok(instruments.has('TSM'), 'Instruments should contain TSM');

  const ticker = await fetchPolymarketTicker('TSM');
  assert.ok(ticker !== null, 'Polymarket ticker for TSM should not be null');
  assert.strictEqual(ticker.symbol, 'TSM');
  assert.ok(ticker.markPrice > 0, 'Mark price should be positive');
  assert.strictEqual(ticker.mmr, 0.05, 'Polymarket MMR for 10x market should be 5.0%');
});
