const LIGHTER_BASE_URL = 'https://api.rh.lighter.xyz';
const LIGHTER_ARB_BASE_URL = 'https://mainnet.zklighter.elliot.ai';
// Кеш соответствия symbol -> marketId
const marketCaches = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут
export async function getLighterMarketId(symbol, venue = 'rh') {
    const normSymbol = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
    const now = Date.now();
    const cached = marketCaches.get(venue);
    if (cached && now - cached.timestamp < CACHE_TTL_MS)
        return cached.markets.get(normSymbol) ?? null;
    const base = venue === 'rh' ? LIGHTER_BASE_URL : LIGHTER_ARB_BASE_URL;
    try {
        const res = await fetch(`${base}/api/v1/orderBooks`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json());
        const newCache = new Map();
        for (const ob of data.order_books || []) {
            newCache.set(ob.symbol.toUpperCase(), ob.market_id);
        }
        marketCaches.set(venue, { markets: newCache, timestamp: now });
        return newCache.get(normSymbol) ?? null;
    }
    catch (err) {
        console.error(`[Lighter] Ошибка загрузки списка рынков:`, err);
        return cached?.markets.get(normSymbol) ?? null;
    }
}
export async function fetchLighterTicker(symbol, venue = 'rh') {
    const marketId = await getLighterMarketId(symbol, venue);
    const base = venue === 'rh' ? LIGHTER_BASE_URL : LIGHTER_ARB_BASE_URL;
    if (marketId === null) {
        return null;
    }
    try {
        const res = await fetch(`${base}/api/v1/orderBookDetails?market_id=${marketId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json());
        const details = json.order_book_details?.[0];
        if (!details)
            return null;
        const markPrice = parseFloat(details.mark_price) || 0;
        const indexPrice = parseFloat(details.index_price) || markPrice;
        const lastPrice = details.last_trade_price || markPrice;
        const mmrFraction = details.maintenance_margin_fraction ? details.maintenance_margin_fraction / 10000 : 0.06;
        // В контракте Lighter базовая часовая ставка = base_interest_rate
        const fundingRate1h = parseFloat(details.base_interest_rate || '0.0004') / 100;
        return {
            symbol: details.symbol.toUpperCase(),
            marketId: details.market_id,
            markPrice,
            indexPrice,
            lastTradePrice: lastPrice,
            fundingRate1h,
            mmr: mmrFraction,
            maxLeverage: 10,
            timestamp: Date.now(),
        };
    }
    catch (err) {
        console.error(`[Lighter] Ошибка получения тикера ${symbol}:`, err);
        return null;
    }
}
export async function lighterGet(venue, endpoint, params) {
    const base = venue === 'arb' ? LIGHTER_ARB_BASE_URL : LIGHTER_BASE_URL;
    const response = await fetch(`${base}/api/v1/${endpoint}?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
        throw new Error(`Lighter ${venue}: HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== undefined && data.code !== 200)
        throw new Error(`Lighter ${venue}: code ${data.code}`);
    return data;
}
export async function readLighterAccount(address, venue) {
    if (!address.trim())
        throw new Error('Lighter wallet is not configured');
    const { accounts } = await lighterGet(venue, 'account', new URLSearchParams({ by: 'l1_address', value: address.trim() }));
    if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(accounts[0]?.positions)) {
        throw new Error(`Lighter ${venue}: cannot identify a single account with positions`);
    }
    const account = accounts[0];
    const index = account.account_index ?? account.index;
    const markets = new Map();
    const positions = [];
    for (const raw of account.positions) {
        const symbol = raw.symbol.toUpperCase();
        const size = Math.abs(Number(raw.position));
        if (!Number.isFinite(size))
            throw new Error('Invalid Lighter position quantity');
        markets.set(symbol, raw.market_id);
        if (!size)
            continue;
        const entryPrice = Number(raw.avg_entry_price);
        if (!(entryPrice > 0) || (raw.sign !== -1 && raw.sign !== 1))
            throw new Error('Invalid Lighter open position');
        positions.push({
            symbol, size, entryPrice, sizeDecimals: raw.position.split('.')[1]?.length ?? 0,
            side: raw.sign === -1 ? 'short' : 'long',
            pnl: Number(raw.unrealized_pnl) || 0, marketIndex: raw.market_id,
            liquidationPrice: Number(raw.liquidation_price) || 0,
            positionValue: Number(raw.position_value) || 0,
            allocatedMargin: Number(raw.allocated_margin) || 0,
            accountCollateral: Number(account.collateral) || 0,
            initialMarginFraction: Number(raw.initial_margin_fraction) || 0,
        });
    }
    return {
        index, positions, markets,
        equity: Number(account.total_asset_value ?? account.collateral),
        available: Number(account.available_balance),
    };
}
export async function fetchLighterPositions(address, venue = 'rh') {
    if (!address.trim())
        return [];
    try {
        return (await readLighterAccount(address, venue)).positions;
    }
    catch {
        return [];
    }
}
