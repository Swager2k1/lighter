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

test('getCurrentTradingWeek rolls over on Friday UTC', async () => {
  const { getCurrentTradingWeek } = await import('../src/services/positionSyncService.js');
  const weekInfo = getCurrentTradingWeek(new Date('2026-11-19T23:59:59Z'));
  assert.deepEqual(getCurrentTradingWeek(new Date('2026-11-20T00:00:00Z')), { week: 'Week 11', period: '20.11 - 27.11' });
  assert.equal(weekInfo.week, 'Week 10');
  assert.equal(weekInfo.period, '13.11 - 20.11');
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





test('reconstructs a closed short including partial liquidation, using separate execution prices', async () => {
  const { reconstructClosedCycle } = await import('../src/services/lighterExecutions.js');
  const opening = { trade_id: 1, timestamp: 1000, size: '10', price: '100', usd_amount: '1000', ask_account_id: 1, bid_account_id: 2, is_maker_ask: false, taker_position_size_before: '0' };
  const liquidation = { trade_id: 2, timestamp: 2000, size: '4', price: '118', usd_amount: '472', ask_account_id: 2, bid_account_id: 1, is_maker_ask: true, taker_position_size_before: '-10', type: 'liquidation', taker_fee: 10000 };
  const closing = { ...liquidation, trade_id: 3, timestamp: 3000, size: '6', price: '112', usd_amount: '672', taker_position_size_before: '-6', type: 'trade', taker_fee: 0 };
  const cycle = reconstructClosedCycle([closing, opening, liquidation], 1, 'short', 1500);
  assert.equal(cycle?.entryPrice, 100);
  assert.equal(cycle?.exitPrice, 114.4);
  assert.equal(cycle?.pricePnl, -144);
  assert.equal(cycle?.fees, 4.72);
  assert.equal(cycle?.liquidatedSize, 4);
  assert.equal(reconstructClosedCycle([closing, liquidation], 1, 'short', 1500), null);
  assert.equal(reconstructClosedCycle([opening, liquidation], 1, 'short', 1500), null);
  assert.equal(reconstructClosedCycle([opening, liquidation, closing], 1, 'long', 1500), null);
});

test('record close keeps both positions active until verified fills and durable CSV, then logs once', async (t) => {
  const { default: fs } = await import('node:fs');
  const { deactivateHedgeOnchain } = await import('../src/services/positionSyncService.js');
  const { githubSyncService } = await import('../src/services/githubSyncService.js');
  const { loadConfig } = await import('../src/config.js');
  const wallet = '0xW1';
  const closed = Date.UTC(2026, 10, 27, 14, 25);
  const opened = closed - 60_000;
  const hedge = {
    id: 'SKHY_W1', symbol: 'SKHY', walletSlot: 'w1', active: true,
    createdAt: opened + 1000, updatedAt: opened + 1000,
    legs: [
      { id: 'rh_skhy_w1_short', name: 'RH', venue: 'lighter', side: 'short', size: 10, entryPrice: 100, margin: 142, walletAddress: wallet },
      { id: 'core_skhy_w1_long', name: 'Core', venue: 'lighter', side: 'long', size: 10, entryPrice: 101, margin: 144, walletAddress: wallet },
    ],
  };
  const files = new Map(Object.entries({
    'config.json': JSON.stringify({ wallets: { robinhoodWallet1: wallet }, hedges: [hedge], currentHedge: hedge }),
    'pnl_and_points_analysis.csv': 'Week,Period,Asset,Venue',
  }));
  const name = (file: unknown) => String(file).split(/[\\/]/).at(-1)!;
  const originalRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file: string, options: BufferEncoding) => files.get(name(file)) ?? originalRead(file, options));
  t.mock.method(fs, 'writeFileSync', (file: string, data: string) => { files.set(name(file), data); });
  t.mock.method(fs, 'renameSync', (from: string, to: string) => { files.set(name(to), files.get(name(from))!); });
  t.mock.method(fs, 'appendFileSync', (file: string, data: string) => { files.set(name(file), files.get(name(file)) + data); });
  t.mock.method(githubSyncService, 'syncConfigFile', async () => ({ success: true }));

  let api = 'error';
  let saveCsv = false;
  t.mock.method(githubSyncService, 'syncCsvFile', async () => ({ success: saveCsv }));
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const rh = input.includes('api.rh.lighter');
    const account = rh ? 22503 : 746192;
    if (input.includes('/account?')) {
      if (api === 'error' && !rh) return Response.json({}, { status: 503 });
      return Response.json({ accounts: [{
        account_index: account,
        positions: [{ symbol: 'SKHY', market_id: 0, position: api === 'partial' && !rh ? '2.0' : '0', sign: rh ? -1 : 1, avg_entry_price: rh ? '100' : '101' }],
      }] });
    }
    assert.match(input, /\/trades\?/);
    const fill = (entry: boolean) => {
      const sell = entry === rh;
      return {
        trade_id: entry ? 1 : 2, market_id: 0, timestamp: entry ? opened : closed, size: '10',
        usd_amount: String((rh ? (entry ? 100 : 120) : (entry ? 101 : 114)) * 10),
        ask_account_id: sell ? account : 1, bid_account_id: sell ? 1 : account,
        is_maker_ask: !sell, taker_position_size_before: entry ? '0' : rh ? '-10' : '10',
      };
    };
    return Response.json({ trades: [fill(false), fill(true)] });
  });

  assert.match(await deactivateHedgeOnchain('SKHY', 'w1'), /Мониторинг сохранён|мониторинг сохранён/);
  assert.equal(loadConfig().hedges?.[0].active, true);
  api = 'partial';
  assert.match(await deactivateHedgeOnchain('SKHY', 'w1'), /ещё открыт на Core/);
  assert.equal(loadConfig().hedges?.[0].active, true);
  api = 'closed';
  assert.match(await deactivateHedgeOnchain('SKHY', 'w1', undefined, opened), /другой позиции/);
  assert.match(await deactivateHedgeOnchain('SKHY', 'w1'), /сохранение CSV не подтверждено/);
  assert.equal(loadConfig().hedges?.[0].active, true);
  saveCsv = true;
  const reply = await deactivateHedgeOnchain('SKHY', 'w1');
  assert.match(reply, /PnL по ценам \*\*\$-70.00/);
  assert.equal(loadConfig().hedges?.[0].active, false);
  assert.match(await deactivateHedgeOnchain('SKHY', 'w1'), /не найдена/);
  const journal = files.get('pnl_and_points_analysis.csv')!;
  assert.equal(journal.match(/\[fills:w1:2:2\]/g)?.length, 1);
  assert.match(journal, /,-70,-,0,-,-,/);
});

