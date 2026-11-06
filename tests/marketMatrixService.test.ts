import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateOrderbookWalk,
  calculateDynamicNotional,
  formatTopCardsMessage,
  generateCanonicalMarkdownFile,
  sortMarketMatrixRows,
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

test('sortMarketMatrixRows prioritizes Boost -> Stocks (by loss100Pct) -> Other pairs', () => {
  const rowCrypto: MarketMatrixRow = {
    symbol: 'BTC',
    type: 'Crypto',
    isStock: false,
    earningsText: '— (Без отчета 🟢)',
    hasEarningsBoost: false,
    daysUntilEarnings: 999999,
    loss100Usd: 5,
    loss100Pct: 0.01, // Очень низкий лосс
    loss50Usd: 2.5,
    loss50Pct: 0.01,
    oiRobinhoodUsd: 100000,
    oiArbitrumUsd: 500000,
    wallRhL1: '$80k',
    wallRhL2: '—',
    wallArbL1: '$80.1k',
    wallArbL2: '—',
    maxEntryWallUsd: 50000,
    edgeSpreadPct: 0.01,
    macroRisk: '🟢 Безопасно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const rowStockHighLoss: MarketMatrixRow = {
    symbol: 'TSLA',
    type: 'Stock',
    isStock: true,
    earningsText: '— (Без отчета 🟢)',
    hasEarningsBoost: false,
    daysUntilEarnings: 999999,
    loss100Usd: 35,
    loss100Pct: 0.10,
    loss50Usd: 17.5,
    loss50Pct: 0.10,
    oiRobinhoodUsd: 400000,
    oiArbitrumUsd: 800000,
    wallRhL1: '$300',
    wallRhL2: '—',
    wallArbL1: '$301',
    wallArbL2: '—',
    maxEntryWallUsd: 15000,
    edgeSpreadPct: 0.05,
    macroRisk: '🟢 Безопасно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const rowStockLowLoss: MarketMatrixRow = {
    symbol: 'AAPL',
    type: 'Stock',
    isStock: true,
    earningsText: '— (Без отчета 🟢)',
    hasEarningsBoost: false,
    daysUntilEarnings: 999999,
    loss100Usd: 10,
    loss100Pct: 0.03, // Меньший лосс чем у TSLA
    loss50Usd: 5,
    loss50Pct: 0.03,
    oiRobinhoodUsd: 300000,
    oiArbitrumUsd: 600000,
    wallRhL1: '$200',
    wallRhL2: '—',
    wallArbL1: '$200.5',
    wallArbL2: '—',
    maxEntryWallUsd: 20000,
    edgeSpreadPct: 0.02,
    macroRisk: '🟢 Безопасно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const rowBoostListing: MarketMatrixRow = {
    symbol: 'BMNR',
    type: 'Stock',
    isStock: true,
    earningsText: '🔥 НОВЫЙ ЛИСТИНГ',
    hasEarningsBoost: true,
    daysUntilEarnings: 0,
    loss100Usd: 20,
    loss100Pct: 0.06,
    loss50Usd: 10,
    loss50Pct: 0.06,
    oiRobinhoodUsd: 50000,
    oiArbitrumUsd: 100000,
    wallRhL1: '$20',
    wallRhL2: '—',
    wallArbL1: '$20.1',
    wallArbL2: '—',
    maxEntryWallUsd: 10000,
    edgeSpreadPct: 0.03,
    macroRisk: '🟡 Свежий рынок',
    verdict: 'БИТЬ МАРКЕТОМ (🔥 Буст листинга)',
  };

  const rowBoostCryptoLowLoss: MarketMatrixRow = {
    symbol: 'ZRO',
    type: 'Crypto',
    isStock: false,
    earningsText: '🔥 НОВЫЙ ЛИСТИНГ',
    hasEarningsBoost: true,
    daysUntilEarnings: 0,
    loss100Usd: 5,
    loss100Pct: 0.02, // Меньший лосс чем у BMNR
    loss50Usd: 2.5,
    loss50Pct: 0.02,
    oiRobinhoodUsd: 60000,
    oiArbitrumUsd: 120000,
    wallRhL1: '$1.6',
    wallRhL2: '—',
    wallArbL1: '$1.61',
    wallArbL2: '—',
    maxEntryWallUsd: 8000,
    edgeSpreadPct: 0.02,
    macroRisk: '🟢 Стабильно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const rows = [rowCrypto, rowStockHighLoss, rowStockLowLoss, rowBoostListing, rowBoostCryptoLowLoss];
  const sorted = sortMarketMatrixRows(rows);

  // 1-й: Буст с меньшим лоссом (ZRO: 0.02% vs BMNR: 0.06%)
  assert.equal(sorted[0].symbol, 'ZRO');
  // 2-й: Следующий буст (BMNR)
  assert.equal(sorted[1].symbol, 'BMNR');
  // 3-й: Акция с меньшим лоссом (AAPL: 0.03% vs TSLA: 0.10%)
  assert.equal(sorted[2].symbol, 'AAPL');
  // 4-й: Акция со следующим лоссом (TSLA)
  assert.equal(sorted[3].symbol, 'TSLA');
  // 5-й: Крипто (BTC) идет после всех акций
  assert.equal(sorted[4].symbol, 'BTC');
});

test('generateCanonicalJsonFile produces valid structured JSON with boosts, stocks and other sections', () => {
  const sampleBoost: MarketMatrixRow = {
    symbol: 'BMNR',
    type: 'Stock',
    isStock: true,
    earningsText: '🔥 НОВЫЙ ЛИСТИНГ',
    hasEarningsBoost: true,
    daysUntilEarnings: 0,
    loss100Usd: 15.0,
    loss100Pct: 0.04,
    loss50Usd: 7.5,
    loss50Pct: 0.04,
    oiRobinhoodUsd: 200000,
    oiArbitrumUsd: 400000,
    wallRhL1: '$18',
    wallRhL2: '$17.9',
    wallArbL1: '$18.1',
    wallArbL2: '$18.2',
    maxEntryWallUsd: 10000,
    edgeSpreadPct: 0.04,
    macroRisk: '🟢 Безопасно',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const sampleStock: MarketMatrixRow = {
    symbol: 'MSFT',
    type: 'Stock',
    isStock: true,
    earningsText: '— (Без отчета 🟢)',
    hasEarningsBoost: false,
    daysUntilEarnings: 999999,
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

  const sampleCrypto: MarketMatrixRow = {
    symbol: 'SOL',
    type: 'Crypto',
    isStock: false,
    earningsText: '— (Без отчета 🟢)',
    hasEarningsBoost: false,
    daysUntilEarnings: 999999,
    loss100Usd: 8.0,
    loss100Pct: 0.02,
    loss50Usd: 4.0,
    loss50Pct: 0.02,
    oiRobinhoodUsd: 1500000,
    oiArbitrumUsd: 5000000,
    wallRhL1: '$92 (50k)',
    wallRhL2: '$91.5 (60k)',
    wallArbL1: '$92.1 (40k)',
    wallArbL2: '$92.5 (55k)',
    maxEntryWallUsd: 40000,
    edgeSpreadPct: 0.015,
    macroRisk: '🟢 Высокая ликвидность',
    verdict: 'БИТЬ МАРКЕТОМ',
  };

  const jsonStr = generateCanonicalMarkdownFile([sampleBoost, sampleStock, sampleCrypto], calculateDynamicNotional(10000));
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.total_markets, 3);
  assert.equal(parsed.total_boosts, 1);
  assert.equal(parsed.total_stocks, 1);
  assert.equal(parsed.total_other_markets, 1);
  assert.ok(Array.isArray(parsed.boosts_section));
  assert.ok(Array.isArray(parsed.stocks_section));
  assert.ok(Array.isArray(parsed.other_markets_section));
  assert.equal(parsed.boosts_section[0].symbol, 'BMNR');
  assert.equal(parsed.stocks_section[0].symbol, 'MSFT');
  assert.equal(parsed.other_markets_section[0].symbol, 'SOL');
  assert.ok(parsed.markets[0].divider.includes('СЕКЦИЯ БУСТОВ'));
  assert.equal(parsed.markets[0].symbol, 'BMNR');
  assert.ok(parsed.markets[1].divider.includes('СЕКЦИЯ АКЦИЙ'));
  assert.equal(parsed.markets[1].symbol, 'MSFT');
  assert.ok(parsed.markets[2].divider.includes('ДРУГИЕ РЫНКИ'));
  assert.equal(parsed.markets[2].symbol, 'SOL');
});
