import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { getHedgeKey, saveHedgeConfig, deactivateHedge, findHedge, loadConfig } from '../src/config.js';
import { parseCloseCommandArgs } from '../src/services/positionSyncService.js';
import { ThreeLegHedge } from '../src/types.js';

describe('Multi-Wallet Simultaneous Hedges Architecture', () => {
  it('parseCloseCommandArgs parses symbol, targetWallet and price', () => {
    const res1 = parseCloseCommandArgs(['SKHY', 'w1']);
    assert.strictEqual(res1.symbol, 'SKHY');
    assert.strictEqual(res1.targetWallet, 'w1');
    assert.strictEqual(res1.exitPrice, undefined);

    const res2 = parseCloseCommandArgs(['SKHY', 'w2', '135.5']);
    assert.strictEqual(res2.symbol, 'SKHY');
    assert.strictEqual(res2.targetWallet, 'w2');
    assert.strictEqual(res2.exitPrice, 135.5);

    const res3 = parseCloseCommandArgs(['SKHY', '135.5', 'w1']);
    assert.strictEqual(res3.symbol, 'SKHY');
    assert.strictEqual(res3.targetWallet, 'w1');
    assert.strictEqual(res3.exitPrice, 135.5);
  });

  it('getHedgeKey generates unique keys for w1 and w2 for the same symbol', () => {
    const hedgeW1: ThreeLegHedge = {
      id: 'SKHY_W1',
      symbol: 'SKHY',
      walletSlot: 'w1',
      active: true,
      legs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const hedgeW2: ThreeLegHedge = {
      id: 'SKHY_W2',
      symbol: 'SKHY',
      walletSlot: 'w2',
      active: true,
      legs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    assert.strictEqual(getHedgeKey(hedgeW1), 'SKHY_W1');
    assert.strictEqual(getHedgeKey(hedgeW2), 'SKHY_W2');
    assert.notStrictEqual(getHedgeKey(hedgeW1), getHedgeKey(hedgeW2));
  });

  it('saveHedgeConfig does not overwrite different wallets of the same symbol', () => {
    const hedgeW1: ThreeLegHedge = {
      id: 'TESTSYM_W1',
      symbol: 'TESTSYM',
      walletSlot: 'w1',
      active: true,
      legs: [
        {
          id: 'rh_test_w1',
          name: 'W1',
          venue: 'lighter',
          side: 'short',
          margin: 1000,
          entryPrice: 100,
          leverage: 7,
          size: 10,
          walletAddress: '0x1111111111111111111111111111111111111111',
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const hedgeW2: ThreeLegHedge = {
      id: 'TESTSYM_W2',
      symbol: 'TESTSYM',
      walletSlot: 'w2',
      active: true,
      legs: [
        {
          id: 'rh_test_w2',
          name: 'W2',
          venue: 'lighter',
          side: 'short',
          margin: 500,
          entryPrice: 100,
          leverage: 7,
          size: 5,
          walletAddress: '0x2222222222222222222222222222222222222222',
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    saveHedgeConfig(hedgeW1);
    saveHedgeConfig(hedgeW2);

    const cfg = loadConfig();
    const w1Found = findHedge(cfg, 'TESTSYM', 'w1');
    const w2Found = findHedge(cfg, 'TESTSYM', 'w2');

    assert.ok(w1Found, 'W1 hedge must be present');
    assert.ok(w2Found, 'W2 hedge must be present');
    assert.strictEqual(w1Found?.legs[0]?.size, 10);
    assert.strictEqual(w2Found?.legs[0]?.size, 5);

    // Deactivate only W1
    deactivateHedge('TESTSYM', 'w1');
    const cfgAfterDeact = loadConfig();
    const w1After = findHedge(cfgAfterDeact, 'TESTSYM', 'w1');
    const w2After = findHedge(cfgAfterDeact, 'TESTSYM', 'w2');

    assert.strictEqual(w1After?.active, false, 'W1 must be deactivated');
    assert.strictEqual(w2After?.active, true, 'W2 must remain active');

    // Clean up test hedges
    deactivateHedge('TESTSYM', 'w2');
    const finalCfg = loadConfig();
    finalCfg.hedges = finalCfg.hedges.filter(h => !h.id.startsWith('TESTSYM'));
    const activeHedge = finalCfg.hedges.find(h => h.active);
    if (activeHedge) {
      finalCfg.currentHedge = activeHedge;
    }
    fs.writeFileSync('config.json', JSON.stringify(finalCfg, null, 2), 'utf8');
  });
});

