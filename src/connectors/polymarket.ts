export interface PolymarketMarketData {
  symbol: string;
  instrumentId: number;
  markPrice: number;
  indexPrice: number;
  lastPrice: number;
  fundingRate1h: number;
  mmr: number;
  maxLeverage: number;
  timestamp: number;
}

export interface PolymarketPosition {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  size: number;
  pnl: number;
}

const POLY_BASE_URL = 'https://api.perpetuals.polymarket.com';

interface InstrumentRaw {
  instrument_id: number;
  symbol: string;
  base_asset: string;
  max_leverage: number;
  liquidation_fee: string;
}

interface TickerRaw {
  instrument_id: number;
  symbol: string;
  index_price: string;
  mark_price: string;
  last_price: string;
  mid_price: string;
  funding_rate: string;
  timestamp: number;
}

let instrumentsCache: Map<string, InstrumentRaw> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 минут

export async function fetchPolymarketInstruments(): Promise<Map<string, InstrumentRaw>> {
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

    const list = (await res.json()) as InstrumentRaw[];
    const map = new Map<string, InstrumentRaw>();

    for (const item of list || []) {
      const cleanBase = item.base_asset.toUpperCase();
      map.set(cleanBase, item);
      map.set(item.symbol.toUpperCase(), item);
    }

    instrumentsCache = map;
    cacheTimestamp = now;
    return map;
  } catch (err) {
    console.error(`[Polymarket] Ошибка загрузки инструментов:`, err);
    return instrumentsCache;
  }
}

export async function fetchPolymarketTicker(symbol: string): Promise<PolymarketMarketData | null> {
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

    const tickers = (await res.json()) as TickerRaw[];
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
  } catch (err) {
    console.error(`[Polymarket] Ошибка получения тикера ${symbol}:`, err);
    return null;
  }
}

export async function fetchAllPolymarketTickers(): Promise<Map<number, TickerRaw>> {
  try {
    const res = await fetch(`${POLY_BASE_URL}/v1/info/tickers`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return new Map();

    const list = (await res.json()) as TickerRaw[];
    const map = new Map<number, TickerRaw>();
    for (const item of list || []) {
      map.set(item.instrument_id, item);
    }
    return map;
  } catch (err) {
    console.error('[Polymarket] Ошибка загрузки всех тикеров:', err);
    return new Map();
  }
}
