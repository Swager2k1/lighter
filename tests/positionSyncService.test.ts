import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEntryFriction,
  formatCsvEntryRow,
  formatCsvExitRow,
} from '../src/services/positionSyncService.js';

test('calculateEntryFriction calculates dollar and percent cost of entry', () => {
  const friction = calculateEntryFriction({
    rhShortPrice: 427.40,
    arbLongPrice: 428.10,
    size: 13.84,
    notional: 5925,
  });

  assert.equal(friction.frictionUsd, 9.69); // (428.10 - 427.40) * 13.84 = 9.688
  assert.ok(friction.frictionPct > 0.15 && friction.frictionPct < 0.17);
});

test('formatCsvEntryRow produces valid CSV row for pnl_and_points_analysis.csv', () => {
  const row = formatCsvEntryRow({
    week: 'Week 11',
    period: '24.10 - 30.10',
    asset: 'TSM',
    venue: 'Robinhood (W1)',
    legDescription: 'Robinhood 1 (Short)',
    side: 'SHORT',
    entryPrice: 427.40,
    size: 13.84,
    margin: 860,
    frictionUsd: 9.69,
  });

  assert.ok(row.includes('Week 11'));
  assert.ok(row.includes('TSM'));
  assert.ok(row.includes('427.4'));
});

test('formatCsvExitRow produces valid CSV closing row for pnl_and_points_analysis.csv', () => {
  const row = formatCsvExitRow({
    week: 'Week 11',
    period: '24.10 - 30.10',
    asset: 'AMD',
    venue: 'Robinhood + Arbitrum',
    legDescription: 'AMD Closed Hedge',
    side: 'Delta-Neutral',
    entryPrice: 539.47,
    exitPrice: 515.40,
    size: 31.58,
    margin: 2433,
    netPnl: -15.16,
    netBalanceChange: -15.23,
  });

  assert.ok(row.includes('Week 11'));
  assert.ok(row.includes('AMD'));
  assert.ok(row.includes('-15.23'));
});

test('parseOpenCommandArgs correctly parses ticker, wallet, manual size, price and leverage', async () => {
  const { parseOpenCommandArgs } = await import('../src/services/positionSyncService.js');

  const t1 = parseOpenCommandArgs(['INTC']);
  assert.equal(t1.symbol, 'INTC');
  assert.equal(t1.targetWallet, undefined);
  assert.equal(t1.manualSize, undefined);

  const t2 = parseOpenCommandArgs(['INTC', 'w1']);
  assert.equal(t2.symbol, 'INTC');
  assert.equal(t2.targetWallet, 'w1');

  const t3 = parseOpenCommandArgs(['INTC', '452']);
  assert.equal(t3.symbol, 'INTC');
  assert.equal(t3.manualSize, 452);

  const t4 = parseOpenCommandArgs(['INTC', '452', '86.15']);
  assert.equal(t4.symbol, 'INTC');
  assert.equal(t4.manualSize, 452);
  assert.equal(t4.manualPrice, 86.15);

  const t5 = parseOpenCommandArgs(['INTC', 'w2', '300', '85.5', '8x']);
  assert.equal(t5.symbol, 'INTC');
  assert.equal(t5.targetWallet, 'w2');
  assert.equal(t5.manualSize, 300);
  assert.equal(t5.manualPrice, 85.5);
  assert.equal(t5.manualLeverage, 8);

  const t6 = parseOpenCommandArgs(['INTC', '8x']);
  assert.equal(t6.symbol, 'INTC');
  assert.equal(t6.manualLeverage, 8);
});

test('parseCloseCommandArgs correctly parses symbol and optional exit price', async () => {
  const { parseCloseCommandArgs } = await import('../src/services/positionSyncService.js');

  const c1 = parseCloseCommandArgs(['META']);
  assert.equal(c1.symbol, 'META');
  assert.equal(c1.exitPrice, undefined);

  const c2 = parseCloseCommandArgs(['META', '640.10']);
  assert.equal(c2.symbol, 'META');
  assert.equal(c2.exitPrice, 640.10);
});

test('getCurrentTradingWeek returns Week 7 and 23.10 - 30.10', async () => {
  const { getCurrentTradingWeek } = await import('../src/services/positionSyncService.js');
  const weekInfo = getCurrentTradingWeek();
  assert.equal(weekInfo.week, 'Week 7');
  assert.equal(weekInfo.period, '23.10 - 30.10');
});

test('activateHedgeOnchain loads live on-chain INTC positions from Lighter', async () => {
  const { activateHedgeOnchain } = await import('../src/services/positionSyncService.js');
  const result = await activateHedgeOnchain('INTC');

  assert.ok(result.includes('ПОЗИЦИЯ INTC УСПЕШНО АКТИВИРОВАНА'));
  assert.ok(result.includes('452.0027'));
  assert.ok(result.includes('86.15'));
  assert.ok(result.includes('91.54'));
  assert.ok(result.includes('Week 7'));
});


