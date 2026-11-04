import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMarketHedgeability,
  checkIsNewListing,
  isStockSymbol,
} from '../src/services/marketMatrixService.js';

test('validateMarketHedgeability rejects pairs with force_reduce_only (e.g. BE on Arb)', () => {
  const rhDetail: any = {
    symbol: 'BE',
    market_id: 20,
    status: 'active',
    is_frozen: false,
    open_interest: 1287,
    market_config: { force_reduce_only: false },
  };

  const arbDetailBE: any = {
    symbol: 'BE',
    market_id: 196,
    status: 'active',
    is_frozen: false,
    open_interest: 0,
    open_interest_usd: '0.0',
    market_config: { force_reduce_only: true }, // Запрет открытия!
  };

  const validationBE = validateMarketHedgeability({
    rhDetail,
    arbDetail: arbDetailBE,
    rhBidsCount: 5,
    rhAsksCount: 5,
    arbBidsCount: 0,
    arbAsksCount: 0,
  });

  assert.equal(validationBE.isHedgeable, false);
  assert.ok(validationBE.reason?.includes('force_reduce_only') || validationBE.reason?.includes('Empty'));
});

test('validateMarketHedgeability approves pairs with live liquidity on both sides', () => {
  const rhDetail: any = {
    symbol: 'TSLA',
    market_id: 16,
    status: 'active',
    is_frozen: false,
    open_interest: 5000,
    market_config: { force_reduce_only: false },
  };

  const arbDetail: any = {
    symbol: 'TSLA',
    market_id: 112,
    status: 'active',
    is_frozen: false,
    open_interest: 4000,
    open_interest_usd: '2000000',
    market_config: { force_reduce_only: false },
  };

  const validation = validateMarketHedgeability({
    rhDetail,
    arbDetail,
    rhBidsCount: 10,
    rhAsksCount: 10,
    arbBidsCount: 10,
    arbAsksCount: 10,
  });

  assert.equal(validation.isHedgeable, true);
});

test('checkIsNewListing detects listings created within current week', () => {
  // Текущая неделя с 30.10.2026
  const weekStart = new Date(2026, 9, 30, 0, 0, 0); // 30 Oct 2026
  // Листинг BMNR создан 03.11.2026 (timestamp: 1793716537945)
  const bmnrCreatedAt = '1793716537945'; // 2026-11-03
  assert.equal(checkIsNewListing(bmnrCreatedAt, weekStart), true);

  // Старый листинг (например, июнь 2026: 1782499410902)
  const oldCreatedAt = '1782499410902';
  assert.equal(checkIsNewListing(oldCreatedAt, weekStart), false);
});

test('isStockSymbol correctly differentiates stocks from crypto and other assets', () => {
  assert.equal(isStockSymbol('AAPL'), true);
  assert.equal(isStockSymbol('TSLA'), true);
  assert.equal(isStockSymbol('MSFT'), true);
  assert.equal(isStockSymbol('BMNR'), true); // Bitmain/Miner stock
  assert.equal(isStockSymbol('BTC'), false);
  assert.equal(isStockSymbol('SOL'), false);
  assert.equal(isStockSymbol('QQQ'), false); // ETF
  assert.equal(isStockSymbol('XAU'), false); // Commodity
});

