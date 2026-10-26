import test from 'node:test';
import assert from 'node:assert';
import {
  handleCalcCommand,
  handlePolyWalletCommand,
  formatRiskAlert,
  formatSpikeAlert,
} from '../src/bot/handlers.js';
import { loadConfig, updateWallets } from '../src/config.js';
import { RiskAssessment, SpikeAlert } from '../src/types.js';

test('handleCalcCommand generates clear calculation response', () => {
  const reply = handleCalcCommand(['TSM', '1200', '24h']);
  assert.ok(reply.includes('TSM'));
  assert.ok(reply.includes('РЕКОМЕНДОВАННОЕ ПЛЕЧО'));
  assert.ok(reply.includes('Robinhood Long: **$1200**'));
  assert.ok(reply.includes('Robinhood Short: **$840**'));
  assert.ok(reply.includes('Polymarket Short: **$360**'));
});

test('handlePolyWalletCommand validates and saves address', () => {
  const initialConfig = loadConfig();
  const initialPoly = initialConfig.wallets.polymarketWallet;

  try {
    const invalid = handlePolyWalletCommand('invalid');
    assert.ok(invalid.includes('валидный адрес'));

    const valid = handlePolyWalletCommand('0x1234567890123456789012345678901234567890');
    assert.ok(valid.includes('успешно обновлен'));
  } finally {
    // Восстанавливаем оригинальный кошелек, чтобы тест не загрязнял боевой config.json
    if (initialPoly !== undefined) {
      updateWallets({ polymarketWallet: initialPoly });
    }
  }
});

test('formatRiskAlert builds high-priority notification', () => {
  const assessment: RiskAssessment = {
    legId: 'rh_2',
    name: 'Robinhood 2 (Short)',
    venue: 'lighter',
    side: 'short',
    margin: 700,
    entryPrice: 400,
    currentPrice: 425,
    liquidationPrice: 440,
    distanceToLiqPct: 3.5,
    distanceToLiqUsd: 15,
    unrealizedPnl: -262.5,
    status: 'warning',
  };

  const alertMsg = formatRiskAlert(assessment, 'TSM');
  assert.ok(alertMsg.includes('БУФЕР СОКРАЩАЕТСЯ'));
  assert.ok(alertMsg.includes('3.5%'));
  assert.ok(alertMsg.includes('Robinhood 2 (Short)'));
});

test('formatSpikeAlert builds spike notification', () => {
  const spike: SpikeAlert = {
    symbol: 'TSM',
    startPrice: 400,
    currentPrice: 408,
    changePct: 2.0,
    windowMinutes: 3,
    timestamp: Date.now(),
  };

  const alertMsg = formatSpikeAlert(spike);
  assert.ok(alertMsg.includes('ОБНАРУЖЕН РЕЗКИЙ СКВИЗ'));
  assert.ok(alertMsg.includes('+2% за 3 мин'));
});
