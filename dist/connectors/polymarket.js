const POLY_BASE_URL = 'https://api.perpetuals.polymarket.com';
let instrumentsCache = new Map();
let cacheTimestamp = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 минут
export async function fetchPolymarketInstruments() {
    const now = Date.now();
    if (instrumentsCache.size > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
        return instrumentsCache;
    }
    try {
        const res = await fetch(`${POLY_BASE_URL}/v1/info/instruments`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const list = (await res.json());
        const map = new Map();
        for (const item of list || []) {
            const cleanBase = item.base_asset.toUpperCase();
            map.set(cleanBase, item);
            map.set(item.symbol.toUpperCase(), item);
        }
        instrumentsCache = map;
        cacheTimestamp = now;
        return map;
    }
    catch (err) {
        console.error(`[Polymarket] Ошибка загрузки инструментов:`, err);
        return instrumentsCache;
    }
}
export async function fetchPolymarketTicker(symbol) {
    const normBase = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
    const instruments = await fetchPolymarketInstruments();
    const inst = instruments.get(normBase);
    if (!inst) {
        return null;
    }
    try {
        const res = await fetch(`${POLY_BASE_URL}/v1/info/tickers?instrument_id=${inst.instrument_id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const tickers = (await res.json());
        const ticker = tickers.find((t) => t.instrument_id === inst.instrument_id) || tickers[0];
        if (!ticker) {
            return null;
        }
        const markPrice = parseFloat(ticker.mark_price) || 0;
        const indexPrice = parseFloat(ticker.index_price) || markPrice;
        const lastPrice = parseFloat(ticker.last_price) || markPrice;
        const fundingRate1h = parseFloat(ticker.funding_rate) || 0;
        const maxLeverage = inst.max_leverage || 10;
        // Официальная формула MMR из документации Polymarket: MMR = 0.5 / MaxLeverage
        const mmr = 0.5 / maxLeverage;
        return {
            symbol: normBase,
            instrumentId: inst.instrument_id,
            markPrice,
            indexPrice,
            lastPrice,
            fundingRate1h,
            mmr,
            maxLeverage,
            timestamp: ticker.timestamp || Date.now(),
        };
    }
    catch (err) {
        console.error(`[Polymarket] Ошибка получения тикера ${symbol}:`, err);
        return null;
    }
}
export async function fetchAllPolymarketTickers() {
    try {
        const res = await fetch(`${POLY_BASE_URL}/v1/info/tickers`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return new Map();
        const list = (await res.json());
        const map = new Map();
        for (const item of list || []) {
            map.set(item.instrument_id, item);
        }
        return map;
    }
    catch (err) {
        console.error('[Polymarket] Ошибка загрузки всех тикеров:', err);
        return new Map();
    }
}
