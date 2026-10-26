import { fetchLighterTicker } from '../connectors/lighter.js';
import {
  fetchPolymarketTicker,
  fetchPolymarketInstruments,
  fetchAllPolymarketTickers,
} from '../connectors/polymarket.js';
import { MarketInfo } from '../types.js';

export interface MarketComparison {
  symbol: string;
  lighterPrice: number;
  polymarketPrice: number;
  priceSpreadPct: number;
  lighterFunding1hPct: number;
  polymarketFunding1hPct: number;
  fundingSpread1hPct: number;
  annualizedFundingSpreadPct: number;
  recommendedDirection: string;
}

const LIGHTER_BASE_URL = 'https://api.rh.lighter.xyz';

export async function findCommonMarkets(): Promise<string[]> {
  try {
    const [lighterRes, polyInstruments] = await Promise.all([
      fetch(`${LIGHTER_BASE_URL}/api/v1/orderBooks`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(6000),
      }).then((r) => r.json() as Promise<{ order_books: Array<{ symbol: string }> }>),
      fetchPolymarketInstruments(),
    ]);

    const lighterSymbols = new Set(lighterRes.order_books.map((b) => b.symbol.toUpperCase()));
    const common: string[] = [];

    for (const [key, inst] of polyInstruments.entries()) {
      const base = inst.base_asset.toUpperCase();
      if (lighterSymbols.has(base) && !common.includes(base)) {
        common.push(base);
      }
    }

    return common.sort();
  } catch (err) {
    console.error('[MarketScanner] Ошибка поиска общих рынков:', err);
    // Fallback на проверенный список
    return ['TSM', 'NVDA', 'AAPL', 'AMD', 'MSFT', 'AMZN', 'META', 'TSLA', 'BTC', 'ETH', 'SOL'];
  }
}

export async function scanSharedMarkets(limit = 10): Promise<MarketComparison[]> {
  const common = await findCommonMarkets();
  const selected = common.slice(0, limit);
  const results: MarketComparison[] = [];

  const promises = selected.map(async (sym) => {
    try {
      const [lighter, poly] = await Promise.all([fetchLighterTicker(sym), fetchPolymarketTicker(sym)]);
      if (!lighter || !poly || lighter.markPrice <= 0 || poly.markPrice <= 0) {
        return null;
      }

      const spreadPct = ((lighter.markPrice - poly.markPrice) / poly.markPrice) * 100;
      const lFunding = lighter.fundingRate1h * 100; // in %
      const pFunding = poly.fundingRate1h * 100; // in %
      const fundingSpread = lFunding - pFunding;
      const annualized = fundingSpread * 24 * 365;

      let direction = 'Нейтрально';
      if (lFunding > pFunding) {
        direction = `Выгодно: Lighter SHORT (получает), Poly LONG`;
      } else if (pFunding > lFunding) {
        direction = `Выгодно: Poly SHORT (получает), Lighter LONG`;
      }

      return {
        symbol: sym,
        lighterPrice: lighter.markPrice,
        polymarketPrice: poly.markPrice,
        priceSpreadPct: parseFloat(spreadPct.toFixed(3)),
        lighterFunding1hPct: parseFloat(lFunding.toFixed(5)),
        polymarketFunding1hPct: parseFloat(pFunding.toFixed(5)),
        fundingSpread1hPct: parseFloat(fundingSpread.toFixed(5)),
        annualizedFundingSpreadPct: parseFloat(annualized.toFixed(2)),
        recommendedDirection: direction,
      };
    } catch {
      return null;
    }
  });

  const resolved = await Promise.all(promises);
  for (const item of resolved) {
    if (item) results.push(item);
  }

  return results;
}

export async function getMarketInfo(symbol: string): Promise<MarketInfo | null> {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const [lighter, poly] = await Promise.all([fetchLighterTicker(norm), fetchPolymarketTicker(norm)]);

  if (!lighter && !poly) return null;

  const lMark = lighter?.markPrice || poly?.markPrice || 0;
  const lIndex = lighter?.indexPrice || lMark;
  const pMark = poly?.markPrice || lighter?.markPrice || 0;
  const pIndex = poly?.indexPrice || pMark;

  const spread = pMark > 0 ? ((lMark - pMark) / pMark) * 100 : 0;
  const lFund = lighter?.fundingRate1h || 0;
  const pFund = poly?.fundingRate1h || 0;

  return {
    symbol: norm,
    lighterMarketId: lighter?.marketId,
    polymarketInstrumentId: poly?.instrumentId,
    lighterMarkPrice: lMark,
    lighterIndexPrice: lIndex,
    polymarketMarkPrice: pMark,
    polymarketIndexPrice: pIndex,
    priceSpreadPct: parseFloat(spread.toFixed(3)),
    lighterFundingRate1h: lFund,
    polymarketFundingRate1h: pFund,
    fundingDiff1hPct: parseFloat(((lFund - pFund) * 100).toFixed(5)),
    lastUpdated: Date.now(),
  };
}
