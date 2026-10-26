import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();
const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
export function loadConfig() {
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
    }
    catch (err) {
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
export function saveHedgeConfig(hedge) {
    try {
        const current = loadConfig();
        const existingHedges = current.hedges ? [...current.hedges] : (current.currentHedge ? [{ ...current.currentHedge }] : []);
        const idx = existingHedges.findIndex((h) => h.symbol.toUpperCase() === hedge.symbol.toUpperCase());
        if (idx >= 0) {
            existingHedges[idx] = hedge;
        }
        else {
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
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Ошибка сохранения config.json:', err);
    }
}
export function updateWallets(wallets) {
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
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Ошибка обновления кошельков в config.json:', err);
    }
}
export function getActiveHedges(config) {
    if (config.hedges && config.hedges.length > 0) {
        const active = config.hedges.filter((h) => h.active !== false);
        if (active.length > 0)
            return active;
    }
    return config.currentHedge ? [config.currentHedge] : [];
}
export function deactivateHedge(symbol) {
    try {
        const current = loadConfig();
        let found = false;
        const norm = symbol.toUpperCase().replace('-USD', '').trim();
        if (current.hedges && Array.isArray(current.hedges)) {
            for (const h of current.hedges) {
                if (h.symbol.toUpperCase() === norm) {
                    h.active = false;
                    h.updatedAt = Date.now();
                    found = true;
                }
            }
        }
        if (current.currentHedge && current.currentHedge.symbol.toUpperCase() === norm) {
            current.currentHedge.active = false;
            current.currentHedge.updatedAt = Date.now();
            found = true;
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
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
        }
        return found;
    }
    catch (err) {
        console.error(`Ошибка деактивации связки ${symbol}:`, err);
        return false;
    }
}
