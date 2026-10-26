import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateOrderbookWalk,
  calculateDynamicNotional,
  formatTopCardsMessage,
  generateCanonicalMarkdownFile,
  OrderbookLevel,
  MarketMatrixRow,
} from '../src/services/marketMatrixService.js';

test('calculateDynamicNotional calculates 7x leverage for 100% and 50% scenarios', () => {
  const sizing = calculateDynamicNotional(10000);
  assert.equal(sizing.totalEquity, 10000);
  assert.equal(sizing.margin100Pct, 5000);
  assert.equal(sizing.notional100Pct, 35000); // 5000 * 7
  assert.equal(sizing.margin50Pct, 2500);
  assert.equal(sizing.notional50Pct, 17500); // 2500 * 7
});

test('simulateOrderbookWalk calculates market loss correctly for given depth', () => {
  const rhBids: OrderbookLevel[] = [
    { price: 100, size: 50 }, // $5,000
    { price: 99, size: 100 }, // $9,900
  ];
  const arbAsks: OrderbookLevel[] = [
    { price: 101, size: 50 }, // $5,050
    { price: 102, size: 100 }, // $10,200
  ];

  const walk = simulateOrderbookWalk({
    targetNotional: 10000,
    sellSideLevels: rhBids, // RH Short: sell into bids
    buySideLevels: arbAsks, // Arb Long: buy from asks
  });

  assert.equal(walk.exhausted, false);
  assert.ok(walk.avgSellPrice <= 100);
  assert.ok(walk.avgBuyPrice >= 101);
  assert.ok(walk.lossUsd > 0);
  assert.ok(walk.lossPct > 0);
});

test('formatTopCardsMessage formats top 5 cards with both OI values and losses first', () => {
  const sampleRow: MarketMatrixRow = {
    symbol: 'MSFT',
    type: 'Stock',
    earningsText: '28.10.2026 🔥 EARNINGS BOOST',
    hasEarningsBoost: true,
    daysUntilEarnings: 4,
    loss100Usd: 18.4,
    loss100Pct: 0.05,
    loss50Usd: 9.1,
    loss50Pct: 0.05,
    oiRobinhoodUsd: 310000,
    oiArbitrumUsd: 580000,
    wallRhL1: '$420.5 (20k)',
    wallRhL2: '$420.0 (30k)',
    wallArbL1: '$420.7 (25k)',
    wallArbL2: '$421.0 (35k)',
    maxEntryWallUsd: 20000,
    edgeSpreadPct: 0.047,
    macroRisk: '🟢 Безопасно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const msg = formatTopCardsMessage({
    walletsSummary: '• W1: $9,800 | W2: $4,900',
    sizing: calculateDynamicNotional(10000),
    topRows: [sampleRow],
    mode: 'open',
  });

  assert.ok(msg.includes('OI RH: **$310.0k** 🟢 | OI Arb: **$580.0k**'));
  assert.ok(msg.includes('Потери 100%: **-$18.4**'));
  assert.ok(msg.includes('50%: **-$9.1**'));
});

test('generateCanonicalJsonFile produces valid structured JSON where each metric is separate', () => {
  const sampleRow: MarketMatrixRow = {
    symbol: 'MSFT',
    type: 'Stock',
    earningsText: '28.10.2026 🔥 EARNINGS BOOST',
    hasEarningsBoost: true,
    daysUntilEarnings: 4,
    loss100Usd: 18.4,
    loss100Pct: 0.05,
    loss50Usd: 9.1,
    loss50Pct: 0.05,
    oiRobinhoodUsd: 310000,
    oiArbitrumUsd: 580000,
    wallRhL1: '$420.5 (20k)',
    wallRhL2: '$420.0 (30k)',
    wallArbL1: '$420.7 (25k)',
    wallArbL2: '$421.0 (35k)',
    maxEntryWallUsd: 20000,
    edgeSpreadPct: 0.047,
    macroRisk: '🟢 Безопасно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const jsonStr = generateCanonicalMarkdownFile([sampleRow], calculateDynamicNotional(10000));
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.total_markets, 1);
  assert.equal(parsed.portfolio_equity_usd, 10000);
  assert.equal(parsed.markets[0].symbol, 'MSFT');
  assert.equal(parsed.markets[0].oi_robinhood, '$310.0k');
  assert.equal(parsed.markets[0].loss_market_100pct, '-$18.4 (0.05%)');
  assert.ok(jsonStr.includes('\n  "markets": ['));
});

test('scanCanonicalMarketMatrix targets W2 and calculates sizing under W2 liquidity', async () => {
  const { scanCanonicalMarketMatrix } = await import('../src/services/marketMatrixService.js');
  const matrix = await scanCanonicalMarketMatrix('open', 'w2');

  assert.ok(matrix.topCardsText.includes('Wallet 2 (W2)'));
  assert.ok(matrix.topCardsText.includes('100% Notional'));
  assert.ok(typeof matrix.fileContent === 'string');
});


