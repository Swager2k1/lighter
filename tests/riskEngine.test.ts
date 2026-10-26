import test from 'node:test';
import assert from 'node:assert';
import { calculateLiquidationPrice, evaluateLegRisk, evaluateHedgeRisk } from '../src/services/riskEngine.js';
import { SpikeDetector } from '../src/services/spikeDetector.js';
import { ThreeLegHedge } from '../src/types.js';

test('calculateLiquidationPrice verifies exact MMR mechanics', () => {
  const entry = 100;
  const leverage = 6;

  // Lighter Long: 100 * (1 - 1/6 + 0.06) = 89.33
  const liqLighterLong = calculateLiquidationPrice(entry, leverage, 'long', 'lighter');
  assert.strictEqual(liqLighterLong, 89.33);

  // Lighter Short: 100 * (1 + 1/6 - 0.06) = 110.67
  const liqLighterShort = calculateLiquidationPrice(entry, leverage, 'short', 'lighter');
  assert.strictEqual(liqLighterShort, 110.67);

  // Polymarket Long: 100 * (1 - 1/6 + 0.05) = 88.33
  const liqPolyLong = calculateLiquidationPrice(entry, leverage, 'long', 'polymarket');
  assert.strictEqual(liqPolyLong, 88.33);

  // Polymarket Short: 100 * (1 + 1/6 - 0.05) = 111.67
  const liqPolyShort = calculateLiquidationPrice(entry, leverage, 'short', 'polymarket');
  assert.strictEqual(liqPolyShort, 111.67);
});

test('evaluateHedgeRisk calculates zero delta and balanced PnL', () => {
  const hedge: ThreeLegHedge = {
    symbol: 'TSM',
    active: true,
    legs: [
      {
        id: 'rh_1',
        name: 'RH Long',
        venue: 'lighter',
        side: 'long',
        margin: 1000,
        entryPrice: 400,
        leverage: 6,
        size: 15, // 15 * 400 = 6000 notional
      },
      {
        id: 'rh_2',
        name: 'RH Short',
        venue: 'lighter',
        side: 'short',
        margin: 700,
        entryPrice: 400,
        leverage: 6,
        size: 10.5, // 10.5 * 400 = 4200 notional
      },
      {
        id: 'poly_3',
        name: 'Poly Short',
        venue: 'polymarket',
        side: 'short',
        margin: 300,
        entryPrice: 400,
        leverage: 6,
        size: 4.5, // 4.5 * 400 = 1800 notional
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 1. При цене 400 (цена входа): PnL = 0, дельта = 0
  const summaryAtEntry = evaluateHedgeRisk(hedge, { lighterPrice: 400, polymarketPrice: 400 });
  assert.strictEqual(summaryAtEntry.netDeltaUsd, 0);
  assert.strictEqual(summaryAtEntry.totalUnrealizedPnl, 0);
  assert.strictEqual(summaryAtEntry.legs[0].status, 'safe');

  // 2. При росте цены до 410 (+2.5%):
  // Long PnL: 15 * 10 = +$150
  // Short 1 PnL: 10.5 * (-10) = -$105
  // Short 2 PnL: 4.5 * (-10) = -$45
  // Суммарный PnL: 150 - 105 - 45 = 0!
  const summaryPump = evaluateHedgeRisk(hedge, { lighterPrice: 410, polymarketPrice: 410 });
  assert.strictEqual(summaryPump.totalUnrealizedPnl, 0);
  // На шортах дистанция сократилась
  assert.ok(summaryPump.legs[1].distanceToLiqPct < summaryAtEntry.legs[1].distanceToLiqPct);
});

test('SpikeDetector identifies rapid price moves', () => {
  const detector = new SpikeDetector();
  const t0 = 1000000;

  // Базовый тик
  const alert1 = detector.addTick('TSM', 100.0, { spike1mPct: 1.0, spike3mPct: 1.8, spike5mPct: 2.5 }, t0);
  assert.strictEqual(alert1, null);

  // Спустя 45 секунд скачок на +2.0%
  const alert2 = detector.addTick('TSM', 102.0, { spike1mPct: 1.0, spike3mPct: 1.8, spike5mPct: 2.5 }, t0 + 45000);
  assert.ok(alert2 !== null, 'Should detect spike');
  assert.strictEqual(alert2.symbol, 'TSM');
  assert.strictEqual(alert2.changePct, 2.0);
  assert.strictEqual(alert2.windowMinutes, 1);
});
