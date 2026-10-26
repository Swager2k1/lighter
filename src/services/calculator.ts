import { CalculatorRecommendation } from '../types.js';

// Базовая годовая историческая волатильность по ключевым инструментам
const ASSET_VOLATILITY: Record<string, number> = {
  TSM: 0.34,
  NVDA: 0.52,
  AAPL: 0.22,
  MSFT: 0.24,
  AMZN: 0.32,
  META: 0.38,
  GOOGL: 0.27,
  AMD: 0.48,
  INTC: 0.42,
  TSLA: 0.56,
  COIN: 0.65,
  PLTR: 0.55,
  BTC: 0.5,
  ETH: 0.6,
  SOL: 0.75,
};

export function getAssetVolatility(symbol: string): number {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  return ASSET_VOLATILITY[norm] || 0.35; // 35% по умолчанию для прочих акций
}

export function calculateSafeLeverage(
  symbol: string,
  totalLongMargin: number,
  timeframe: '24h' | '7d' = '24h'
): CalculatorRecommendation {
  const norm = symbol.toUpperCase().replace('-USD', '').replace('-PERP', '');
  const annualVol = getAssetVolatility(norm);

  // Волатильность за выбранный период (1 сигма)
  let periodSigma = 0;
  let safetyMultiplier = 3.0; // 3 сигмы для 99.7% уверенности
  let minBufferPct = 10.0; // Минимальный буфер до ликвидации в %

  if (timeframe === '24h') {
    // 252 торговых дня в году
    periodSigma = annualVol / Math.sqrt(252);
    safetyMultiplier = 3.0; // 3 дневных сигмы
    minBufferPct = 10.0; // На 24ч держим минимум 10% подушки хода
  } else {
    // 52 недели в году
    periodSigma = annualVol / Math.sqrt(52);
    safetyMultiplier = 2.5; // 2.5 недельных сигмы
    minBufferPct = 14.0; // На 7д держим минимум 14% подушки хода
  }

  // Ожидаемое максимальное движение цены по сигмам
  const expectedMaxMovePct = periodSigma * safetyMultiplier * 100;

  // Худший MMR среди площадок (6.0% на Lighter, 5.0% на Polymarket)
  const worstMmr = 0.06;

  // Дистанция до ликвидации должна покрывать и сигмы, и минимальный буфер
  const targetBufferPct = Math.max(expectedMaxMovePct, minBufferPct);
  const targetBufferFraction = targetBufferPct / 100;

  // 1/L = targetBufferFraction + worstMmr
  const maxAllowableLeverage = 1 / (targetBufferFraction + worstMmr);

  // Округляем вниз до целого плеча (но не больше 10x и не меньше 1x)
  let recommendedLeverage = Math.floor(maxAllowableLeverage);
  if (recommendedLeverage > 10) recommendedLeverage = 10;
  if (recommendedLeverage < 1) recommendedLeverage = 1;

  // Фактическая дистанция до ликвидации на Lighter при рекомендованном плече
  const actualDistancePct = (1 / recommendedLeverage - worstMmr) * 100;

  // Расчет распределения маржи (70% на RH Short, 30% на Poly Short)
  const rhShortMargin = Math.round(totalLongMargin * 0.7);
  const polyShortMargin = totalLongMargin - rhShortMargin; // ровно 100% суммарно

  let verdict = '';
  if (timeframe === '24h') {
    if (recommendedLeverage >= 6) {
      verdict = `Плечо ${recommendedLeverage}x отлично подходит на 24 часа. Запас хода ${actualDistancePct.toFixed(1)}% превышает 3 суточные сигмы (${expectedMaxMovePct.toFixed(1)}%). Ликвидация за сутки практически невозможна.`;
    } else {
      verdict = `Актив ${norm} имеет повышенную волатильность (${(annualVol * 100).toFixed(0)}%). На 24 часа рекомендуется ограничить плечо до ${recommendedLeverage}x для запаса хода в ${actualDistancePct.toFixed(1)}%.`;
    }
  } else {
    verdict = `Для удержания на 7 дней волатильность накапливается. Рекомендуемое безопасное плечо — ${recommendedLeverage}x с запасом хода ${actualDistancePct.toFixed(1)}% (покрывает недельный диапазон ${expectedMaxMovePct.toFixed(1)}%).`;
  }

  return {
    symbol: norm,
    totalMargin: totalLongMargin * 2, // Суммарная маржа обеих сторон
    timeframe,
    estimatedVolPct: parseFloat((annualVol * 100).toFixed(1)),
    maxExpectedMovePct: parseFloat(expectedMaxMovePct.toFixed(2)),
    recommendedLeverage,
    distanceToLiqPct: parseFloat(actualDistancePct.toFixed(2)),
    verdict,
    split: {
      leg1RobinhoodLong: {
        margin: totalLongMargin,
        notional: totalLongMargin * recommendedLeverage,
      },
      leg2RobinhoodShort: {
        margin: rhShortMargin,
        notional: rhShortMargin * recommendedLeverage,
      },
      leg3PolymarketShort: {
        margin: polyShortMargin,
        notional: polyShortMargin * recommendedLeverage,
      },
    },
  };
}
