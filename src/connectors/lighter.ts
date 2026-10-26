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
  liquidationPrice?: number;
  positionValue?: number;
  allocatedMargin?: number;
  accountCollateral?: number;
  initialMarginFraction?: number;
}

const LIGHTER_BASE_URL = 'https://api.rh.lighter.xyz';
const LIGHTER_ARB_BASE_URL = 'https://mainnet.zklighter.elliot.ai';

// Кеш соответствия symbol -> marketId
let marketCache: Map<string, number> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут

export async function getLighterMarketId(symbol: string): Promise<number | null> {
  const normSymbol = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const now = Date.now();

  if (marketCache.size > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return marketCache.get(normSymbol) ?? null;
  }

  try {
    const res = await fetch(`${LIGHTER_BASE_URL}/api/v1/orderBooks`, {
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

    marketCache = newCache;
    cacheTimestamp = now;
    return marketCache.get(normSymbol) ?? null;
  } catch (err) {
    console.error(`[Lighter] Ошибка загрузки списка рынков:`, err);
    return marketCache.get(normSymbol) ?? null;
  }
}

export async function fetchLighterTicker(symbol: string): Promise<LighterMarketData | null> {
  const marketId = await getLighterMarketId(symbol);
  if (marketId === null) {
    return null;
  }

  try {
    const res = await fetch(`${LIGHTER_BASE_URL}/api/v1/orderBookDetails?market_id=${marketId}`, {
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

/**
 * Запрос открытых ончейн-позиций аккаунта через официальный API Lighter (Robinhood или Arbitrum Core)
 */
export async function fetchLighterPositions(
  accountOrAddress: string,
  venue: 'rh' | 'arb' = 'rh'
): Promise<LighterPosition[]> {
  if (!accountOrAddress || accountOrAddress.trim() === '') {
    return [];
  }

  const baseUrl = venue === 'arb' ? LIGHTER_ARB_BASE_URL : LIGHTER_BASE_URL;

  try {
    const res = await fetch(`${baseUrl}/api/v1/account?by=l1_address&value=${accountOrAddress.trim()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as {
      accounts?: Array<{
        collateral?: string;
        positions?: Array<{
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
        }>;
      }>;
    };

    const rawPositions = data.accounts?.[0]?.positions;
    const accountCollateral = parseFloat(data.accounts?.[0]?.collateral || '0') || 0;
    if (!Array.isArray(rawPositions)) return [];

    const result: LighterPosition[] = [];
    for (const pos of rawPositions) {
      const size = parseFloat(pos.position) || 0;
      if (size <= 0) continue; // Пропускаем нулевые/закрытые записи

      result.push({
        symbol: pos.symbol.toUpperCase(),
        side: pos.sign === -1 ? 'short' : 'long',
        entryPrice: parseFloat(pos.avg_entry_price) || 0,
        size,
        pnl: parseFloat(pos.unrealized_pnl) || 0,
        marketIndex: pos.market_id,
        liquidationPrice: parseFloat(pos.liquidation_price) || 0,
        positionValue: parseFloat(pos.position_value) || 0,
        allocatedMargin: parseFloat(pos.allocated_margin || '0') || 0,
        accountCollateral,
        initialMarginFraction: parseFloat(pos.initial_margin_fraction || '0') || 0,
      });
    }

    return result;
  } catch (err) {
    console.error(`[Lighter ${venue.toUpperCase()}] Ошибка чтения позиций для ${accountOrAddress}:`, err);
    return [];
  }
}

