import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWalletRebalance } from '../src/services/rebalanceService.js';

test('calculateWalletRebalance computes correct skew when RH exceeds Arb', () => {
  const result = calculateWalletRebalance({
    walletName: 'Wallet 1',
    walletAddress: '0xf5FC58036A680707DB6E7df869bb616A6d35aF7f',
    rhEquity: 7000,
    rhCollateral: 2000,
    arbEquity: 3000,
    arbCollateral: 3000,
  });

  assert.equal(result.totalEquity, 10000);
  assert.equal(result.targetPerLeg, 5000);
  assert.equal(result.skewUsd, 4000);
  assert.equal(result.bridgeAmountUsd, 2000);
  assert.equal(result.bridgeDirection, 'RH_TO_ARB');
  assert.match(result.recommendationText, /Robinhood Chain.*в.*Arbitrum zkLighter/);
});

test('calculateWalletRebalance computes correct skew when Arb exceeds RH', () => {
  const result = calculateWalletRebalance({
    walletName: 'Wallet 2',
    walletAddress: '0x1F1414F64161287f2eb849b09083A50C6C513Ff2',
    rhEquity: 2000,
    rhCollateral: 2000,
    arbEquity: 6000,
    arbCollateral: 1500,
  });

  assert.equal(result.totalEquity, 8000);
  assert.equal(result.targetPerLeg, 4000);
  assert.equal(result.skewUsd, -4000);
  assert.equal(result.bridgeAmountUsd, 2000);
  assert.equal(result.bridgeDirection, 'ARB_TO_RH');
  assert.match(result.recommendationText, /Arbitrum zkLighter.*в.*Robinhood Chain/);
});
