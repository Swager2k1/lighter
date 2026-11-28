export interface LighterMarketData {
  symbol: string;
  marketId: number;
  markPrice: number;
  indexPrice: number;
  lastTradePrice: number;
  fundingRate1h: number;
  mmr: number;
  maxLeverage: number;
  timestamp: number;
}

export interface LighterPosition {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  size: number;
  pnl: number;
  marketIndex: number;
  sizeDecimals?: number;
  liquidationPrice?: number;
  positionValue?: number;
  allocatedMargin?: number;
  accountCollateral?: number;
  initialMarginFraction?: number;
}

const LIGHTER_BASE_URL = 'https://api.rh.lighter.xyz';
const LIGHTER_ARB_BASE_URL = 'https://mainnet.zklighter.elliot.ai';

// Кеш соответствия symbol -> marketId
const marketCaches = new Map<LighterVenue, { markets: Map<string, number>; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут

export async function getLighterMarketId(symbol: string, venue: LighterVenue = 'rh'): Promise<number | null> {
  const normSymbol = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const now = Date.now();

  const cached = marketCaches.get(venue);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) return cached.markets.get(normSymbol) ?? null;
  const base = venue === 'rh' ? LIGHTER_BASE_URL : LIGHTER_ARB_BASE_URL;

  try {
    const res = await fetch(`${base}/api/v1/orderBooks`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as { order_books: Array<{ symbol: string; market_id: number }> };
    const newCache = new Map<string, number>();

    for (const ob of data.order_books || []) {
      newCache.set(ob.symbol.toUpperCase(), ob.market_id);
    }

    marketCaches.set(venue, { markets: newCache, timestamp: now });
    return newCache.get(normSymbol) ?? null;
  } catch (err) {
    console.error(`[Lighter] Ошибка загрузки списка рынков:`, err);
    return cached?.markets.get(normSymbol) ?? null;
  }
}

export async function fetchLighterTicker(symbol: string, venue: LighterVenue = 'rh'): Promise<LighterMarketData | null> {
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

    const json = (await res.json()) as {
      order_book_details: Array<{
        symbol: string;
        market_id: number;
        mark_price: string;
        index_price: string;
        last_trade_price: number;
        maintenance_margin_fraction: number;
        funding_clamp_small: string;
        base_interest_rate: string;
      }>;
    };

    const details = json.order_book_details?.[0];
    if (!details) return null;

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
  } catch (err) {
    console.error(`[Lighter] Ошибка получения тикера ${symbol}:`, err);
    return null;
  }
}

export type LighterVenue = 'rh' | 'arb';

export async function lighterGet<T>(venue: LighterVenue, endpoint: string, params: URLSearchParams): Promise<T> {
  const base = venue === 'arb' ? LIGHTER_ARB_BASE_URL : LIGHTER_BASE_URL;
  const response = await fetch(`${base}/api/v1/${endpoint}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Lighter ${venue}: HTTP ${response.status}`);
  const data = await response.json() as T & { code?: number };
  if (data.code !== undefined && data.code !== 200) throw new Error(`Lighter ${venue}: code ${data.code}`);
  return data;
}

interface AccountPosition {
  market_id: number;
  symbol: string;
  sign: number;
  position: string;
  avg_entry_price: string;
  position_value: string;
  unrealized_pnl: string;
  liquidation_price: string;
  allocated_margin?: string;
  initial_margin_fraction?: string;
}

export async function readLighterAccount(address: string, venue: LighterVenue) {
  if (!address.trim()) throw new Error('Lighter wallet is not configured');
  const { accounts } = await lighterGet<{ accounts: {
    account_index?: number;
    index?: number;
    collateral?: string;
    total_asset_value?: string;
    available_balance?: string;
    positions?: AccountPosition[];
  }[] }>(venue, 'account', new URLSearchParams({ by: 'l1_address', value: address.trim() }));
  if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(accounts[0]?.positions)) {
    throw new Error(`Lighter ${venue}: cannot identify a single account with positions`);
  }
  const account = accounts[0];
  const index = account.account_index ?? account.index;
  const markets = new Map<string, number>();
  const positions: LighterPosition[] = [];
  for (const raw of account.positions!) {
    const symbol = raw.symbol.toUpperCase();
    const size = Math.abs(Number(raw.position));
    if (!Number.isFinite(size)) throw new Error('Invalid Lighter position quantity');
    markets.set(symbol, raw.market_id);
    if (!size) continue;
    const entryPrice = Number(raw.avg_entry_price);
    if (!(entryPrice > 0) || (raw.sign !== -1 && raw.sign !== 1)) throw new Error('Invalid Lighter open position');
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

export async function fetchLighterPositions(address: string, venue: LighterVenue = 'rh'): Promise<LighterPosition[]> {
  if (!address.trim()) return [];
  try {
    return (await readLighterAccount(address, venue)).positions;
  } catch {
    return [];
  }
}
