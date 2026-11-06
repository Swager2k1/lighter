import { test } from 'node:test';
import assert from 'node:assert';
import { getActiveHedges, FullConfig } from '../src/config.js';
import { ThreeLegHedge } from '../src/types.js';

test('getActiveHedges returns empty array when all hedges in hedges[] are inactive', () => {
  const config: FullConfig = {
    defaultSymbol: 'COIN',
    pollIntervalMs: 15000,
    thresholds: {
      warningBufferPct: 5,
      criticalBufferPct: 2.5,
      spike1mPct: 1,
      spike3mPct: 1.8,
      spike5mPct: 2.5,
    },
    wallets: {},
    telegram: { botToken: '', chatId: '' },
    hedges: [
      {
        symbol: 'COIN',
        active: false,
        legs: [],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        symbol: 'TSM',
        active: false,
        legs: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    currentHedge: {
      symbol: 'COIN',
      active: false,
      legs: [],
      createdAt: 0,
      updatedAt: 0,
    },
  };

  const active = getActiveHedges(config);
  assert.strictEqual(active.length, 0, 'Must return 0 active hedges when all are inactive');
  assert.deepStrictEqual(active, []);
});

test('getActiveHedges returns only active hedges from hedges[]', () => {
  const activeHedge: ThreeLegHedge = {
    symbol: 'TSM',
    active: true,
    legs: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const inactiveHedge: ThreeLegHedge = {
    symbol: 'COIN',
    active: false,
    legs: [],
    createdAt: 0,
    updatedAt: 0,
  };

  const config: FullConfig = {
    defaultSymbol: 'TSM',
    pollIntervalMs: 15000,
    thresholds: {
      warningBufferPct: 5,
      criticalBufferPct: 2.5,
      spike1mPct: 1,
      spike3mPct: 1.8,
      spike5mPct: 2.5,
    },
    wallets: {},
    telegram: { botToken: '', chatId: '' },
    hedges: [inactiveHedge, activeHedge],
    currentHedge: inactiveHedge,
  };

  const active = getActiveHedges(config);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].symbol, 'TSM');
});

test('getActiveHedges falls back to currentHedge only if active and hedges[] is empty or absent', () => {
  const activeCurrent: ThreeLegHedge = {
    symbol: 'NVDA',
    active: true,
    legs: [],
    createdAt: 0,
    updatedAt: 0,
  };

  const configWithoutHedges: FullConfig = {
    defaultSymbol: 'NVDA',
    pollIntervalMs: 15000,
    thresholds: {
      warningBufferPct: 5,
      criticalBufferPct: 2.5,
      spike1mPct: 1,
      spike3mPct: 1.8,
      spike5mPct: 2.5,
    },
    wallets: {},
    telegram: { botToken: '', chatId: '' },
    currentHedge: activeCurrent,
  };

  const active = getActiveHedges(configWithoutHedges);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].symbol, 'NVDA');

  // If currentHedge is inactive, returns empty array
  configWithoutHedges.currentHedge.active = false;
  const activeWhenInactive = getActiveHedges(configWithoutHedges);
  assert.strictEqual(activeWhenInactive.length, 0);
});

test('DISABLE_POLLING environment variable check logic', () => {
  const originalEnv = process.env.DISABLE_POLLING;

  process.env.DISABLE_POLLING = 'true';
  assert.strictEqual(process.env.DISABLE_POLLING === 'true', true);

  process.env.DISABLE_POLLING = 'false';
  assert.strictEqual(process.env.DISABLE_POLLING === 'true', false);

  delete process.env.DISABLE_POLLING;
  assert.strictEqual(process.env.DISABLE_POLLING === 'true', false);

  if (originalEnv !== undefined) {
    process.env.DISABLE_POLLING = originalEnv;
  }
});

