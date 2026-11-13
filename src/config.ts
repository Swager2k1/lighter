import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { AppConfig, ThreeLegHedge } from './types.js';
import { githubSyncService } from './services/githubSyncService.js';

dotenv.config();

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');

function writeConfigAndSync(toSave: any, message: string): void {
  const jsonStr = JSON.stringify(toSave, null, 2);
  fs.writeFileSync(CONFIG_PATH, jsonStr, 'utf-8');
  githubSyncService.syncConfigFile(jsonStr, `${message} [skip ci]`).catch((syncErr) => {
    console.warn('[Config] Предупреждение облачной синхронизации config.json:', syncErr?.message || syncErr);
  });
}

export interface FullConfig extends AppConfig {
  currentHedge: ThreeLegHedge;
}

export function loadConfig(): FullConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return {
        ...data,
        telegram: {
          botToken: process.env.TELEGRAM_BOT_TOKEN || '',
          chatId: process.env.TELEGRAM_CHAT_ID || '',
          criticalBotToken: process.env.CRITICAL_TELEGRAM_BOT_TOKEN || '',
        },
      };
    }
  } catch (err) {
    console.error('Ошибка при чтении config.json, используются параметры по умолчанию:', err);
  }

  return {
    defaultSymbol: 'TSM',
    pollIntervalMs: 15000,
    thresholds: {
      warningBufferPct: 5.0,
      criticalBufferPct: 2.5,
      spike1mPct: 1.0,
      spike3mPct: 1.8,
      spike5mPct: 2.5,
    },
    wallets: {},
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
    },
    currentHedge: {
      symbol: 'TSM',
      active: false,
      legs: [
        {
          id: 'rh_long_1',
          name: 'Robinhood 1 (Long)',
          venue: 'lighter',
          side: 'long',
          margin: 1000,
          entryPrice: 428.0,
          leverage: 6,
          size: 14.0187,
        },
        {
          id: 'rh_short_2',
          name: 'Robinhood 2 (Short)',
          venue: 'lighter',
          side: 'short',
          margin: 700,
          entryPrice: 428.0,
          leverage: 6,
          size: 9.8131,
        },
        {
          id: 'poly_short_3',
          name: 'Polymarket (Short)',
          venue: 'polymarket',
          side: 'short',
          margin: 300,
          entryPrice: 428.0,
          leverage: 6,
          size: 4.2056,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

export function getHedgeKey(hedge: { id?: string; symbol: string; walletSlot?: 'w1' | 'w2'; legs?: Array<{ walletAddress?: string }> }): string {
  if (hedge.id && hedge.id.trim() !== '') {
    return hedge.id.toUpperCase();
  }
  const normSym = hedge.symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').trim();
  const slot = hedge.walletSlot?.toLowerCase();
  if (slot === 'w1' || slot === 'w2') {
    return `${normSym}_${slot.toUpperCase()}`;
  }
  // Автодетект по адресу первой ноги
  const wAddr = hedge.legs?.[0]?.walletAddress?.toLowerCase();
  if (wAddr) {
    const cfg = loadConfig();
    const w1 = cfg.wallets.robinhoodWallet1?.toLowerCase();
    const w2 = cfg.wallets.robinhoodWallet2?.toLowerCase();
    if (w1 && wAddr === w1) return `${normSym}_W1`;
    if (w2 && wAddr === w2) return `${normSym}_W2`;
  }
  return normSym;
}

export function saveHedgeConfig(hedge: ThreeLegHedge): void {
  try {
    const current = loadConfig();
    const existingHedges = current.hedges ? [...current.hedges] : (current.currentHedge ? [{ ...current.currentHedge }] : []);
    
    // Присваиваем стабильный составной ID связки
    if (!hedge.id) {
      hedge.id = getHedgeKey(hedge);
    }
    const targetKey = getHedgeKey(hedge);

    const idx = existingHedges.findIndex((h) => getHedgeKey(h) === targetKey);
    if (idx >= 0) {
      existingHedges[idx] = hedge;
    } else {
      existingHedges.push(hedge);
    }
    const toSave = {
      defaultSymbol: current.defaultSymbol,
      pollIntervalMs: current.pollIntervalMs,
      thresholds: current.thresholds,
      wallets: current.wallets,
      hedges: existingHedges,
      currentHedge: hedge,
    };
    writeConfigAndSync(toSave, `sync: save hedge ${hedge.id || hedge.symbol}`);
  } catch (err) {
    console.error('Ошибка сохранения config.json:', err);
  }
}

export function updateWallets(wallets: Partial<AppConfig['wallets']>): void {
  try {
    const current = loadConfig();
    current.wallets = { ...current.wallets, ...wallets };
    const toSave = {
      defaultSymbol: current.defaultSymbol,
      pollIntervalMs: current.pollIntervalMs,
      thresholds: current.thresholds,
      wallets: current.wallets,
      hedges: current.hedges,
      currentHedge: current.currentHedge,
    };
    writeConfigAndSync(toSave, 'sync: update wallets');
  } catch (err) {
    console.error('Ошибка обновления кошельков в config.json:', err);
  }
}

export function getActiveHedges(config: FullConfig): ThreeLegHedge[] {
  if (config.hedges && Array.isArray(config.hedges)) {
    return config.hedges.filter((h) => h.active !== false);
  }
  if (config.currentHedge && config.currentHedge.active !== false) {
    return [config.currentHedge];
  }
  return [];
}

export function findHedge(config: FullConfig, symbol: string, targetWallet?: 'w1' | 'w2'): ThreeLegHedge | undefined {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').trim();
  const activeHedges = getActiveHedges(config);

  if (targetWallet) {
    const slot = targetWallet.toLowerCase();
    // 1. Ищем среди активных конкретного кошелька
    const activeMatch = activeHedges.find(
      (h) => h.symbol.toUpperCase() === norm && (h.walletSlot?.toLowerCase() === slot || getHedgeKey(h).endsWith(`_${slot.toUpperCase()}`))
    );
    if (activeMatch) return activeMatch;

    // 2. Ищем среди всех hedges[] конкретного кошелька
    if (config.hedges && Array.isArray(config.hedges)) {
      const match = config.hedges.find(
        (h) => h.symbol.toUpperCase() === norm && (h.walletSlot?.toLowerCase() === slot || getHedgeKey(h).endsWith(`_${slot.toUpperCase()}`))
      );
      if (match) return match;
    }

    // Если запрошен конкретный кошелек, но его нет — не возвращаем чужой кошелек
    return undefined;
  }

  // Если кошелек не указан:
  // 1. Ищем любую активную связку
  const activeMatch = activeHedges.find((h) => h.symbol.toUpperCase() === norm);
  if (activeMatch) return activeMatch;

  // 2. Ищем любую связку в hedges[]
  if (config.hedges && Array.isArray(config.hedges)) {
    const match = config.hedges.find((h) => h.symbol.toUpperCase() === norm);
    if (match) return match;
  }

  return config.currentHedge?.symbol.toUpperCase() === norm ? config.currentHedge : undefined;
}

export function deactivateHedge(symbol: string, targetWallet?: 'w1' | 'w2'): boolean {
  try {
    const current = loadConfig();
    let found = false;
    const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '').trim();
    const targetSlot = targetWallet?.toLowerCase();

    if (current.hedges && Array.isArray(current.hedges)) {
      for (const h of current.hedges) {
        if (h.symbol.toUpperCase() === norm) {
          const hKey = getHedgeKey(h);
          if (targetSlot) {
            const matchesSlot = h.walletSlot?.toLowerCase() === targetSlot || hKey.endsWith(`_${targetSlot.toUpperCase()}`);
            if (!matchesSlot) continue;
          }
          h.active = false;
          h.updatedAt = Date.now();
          found = true;
        }
      }
    }

    if (current.currentHedge && current.currentHedge.symbol.toUpperCase() === norm) {
      if (!targetSlot || current.currentHedge.walletSlot?.toLowerCase() === targetSlot) {
        current.currentHedge.active = false;
        current.currentHedge.updatedAt = Date.now();
        found = true;
      }
    }

    if (found) {
      const toSave = {
        defaultSymbol: current.defaultSymbol,
        pollIntervalMs: current.pollIntervalMs,
        thresholds: current.thresholds,
        wallets: current.wallets,
        hedges: current.hedges,
        currentHedge: current.currentHedge,
      };
      writeConfigAndSync(toSave, `sync: deactivate hedge ${norm}${targetSlot ? '_' + targetSlot : ''}`);
    }
    return found;
  } catch (err) {
    console.error(`Ошибка деактивации связки ${symbol}:`, err);
    return false;
  }
}

