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

test('getCurrentTradingWeek returns Week 9 and 06.11 - 13.11', async () => {
  const { getCurrentTradingWeek } = await import('../src/services/positionSyncService.js');
  const weekInfo = getCurrentTradingWeek();
  assert.equal(weekInfo.week, 'Week 9');
  assert.equal(weekInfo.period, '06.11 - 13.11');
});

test('parseOpenCommandArgs validates all argument formats safely without side effects', async () => {
  const { parseOpenCommandArgs } = await import('../src/services/positionSyncService.js');
  const parsed = parseOpenCommandArgs(['COIN', 'w1', '100', '150.5', '7x']);
  assert.equal(parsed.symbol, 'COIN');
  assert.equal(parsed.targetWallet, 'w1');
  assert.equal(parsed.manualSize, 100);
  assert.equal(parsed.manualPrice, 150.5);
  assert.equal(parsed.manualLeverage, 7);
});

test('appendRowToCsv triggers cloud sync without throwing errors', async () => {
  const { appendRowToCsv } = await import('../src/services/positionSyncService.js');
  const { githubSyncService } = await import('../src/services/githubSyncService.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const csvPath = path.resolve(process.cwd(), 'pnl_and_points_analysis.csv');
  const originalCsv = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf-8') : null;

  let syncCalled = false;
  const originalSync = githubSyncService.syncCsvFile;
  githubSyncService.syncCsvFile = async (content: string, msg?: string) => {
    syncCalled = true;
    return { success: true };
  };

  try {
    appendRowToCsv('TestWeek,TestPeriod,TESTASSET,Venue,Leg,BUY,100,100,1,10,10,10,0,0,0,0,0,"Test row"');
    assert.equal(syncCalled, true);
  } finally {
    githubSyncService.syncCsvFile = originalSync;
    if (originalCsv !== null) {
      fs.writeFileSync(csvPath, originalCsv, 'utf-8');
    }
  }
});

test('formatCsvExitRow formats note correctly with realistic duration and prices', () => {
  const row = formatCsvExitRow({
    week: 'Week 7',
    period: '23.10 - 30.10',
    asset: 'TSM',
    venue: 'Robinhood + Arbitrum',
    legDescription: 'TSM Closed Hedge',
    side: 'Delta-Neutral',
    entryPrice: 355.88,
    exitPrice: 378.81,
    size: 46.5,
    margin: 85.76,
    netPnl: 24.17,
    netBalanceChange: 24.17,
    notes: 'Closed via /c TSM (12.2ч (с 05.11, 23:28 по 06.11, 11:38). Exit: $378.81, Net PnL: +$24.17)',
  });

  assert.ok(row.includes('12.2ч'));
  assert.ok(row.includes('+24.17'));
});




