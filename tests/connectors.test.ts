import test from 'node:test';
import assert from 'node:assert';
import { fetchLighterTicker, getLighterMarketId } from '../src/connectors/lighter.js';
import { fetchPolymarketTicker, fetchPolymarketInstruments } from '../src/connectors/polymarket.js';

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
