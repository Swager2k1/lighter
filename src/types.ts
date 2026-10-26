export type Venue = 'lighter' | 'polymarket';
export type Side = 'long' | 'short';

export interface LegConfig {
  id: string;
  name: string;
  venue: Venue;
  side: Side;
  margin: number;
  entryPrice: number;
  leverage: number;
  size: number;
  walletAddress?: string;
  liquidationPrice?: number;
}

export interface ThreeLegHedge {
  symbol: string;
  active: boolean;
  legs: LegConfig[];
  createdAt: number;
  updatedAt: number;
}

export interface MarketInfo {
  symbol: string;
  lighterMarketId?: number;
  polymarketInstrumentId?: number;
  lighterMarkPrice: number;
  lighterIndexPrice: number;
  polymarketMarkPrice: number;
  polymarketIndexPrice: number;
  priceSpreadPct: number;
  lighterFundingRate1h: number;
  polymarketFundingRate1h: number;
  fundingDiff1hPct: number;
  lastUpdated: number;
}

export interface RiskAssessment {
  legId: string;
  name: string;
  venue: Venue;
  side: Side;
  margin: number;
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number;
  distanceToLiqPct: number;
  distanceToLiqUsd: number;
  unrealizedPnl: number;
  status: 'safe' | 'warning' | 'critical';
  leverage?: number;
  size?: number;
}

export interface HedgeSummary {
  symbol: string;
  legs: RiskAssessment[];
  totalMargin: number;
  totalNotionalLong: number;
  totalNotionalShort: number;
  netDeltaUsd: number;
  totalUnrealizedPnl: number;
  lowestBufferLeg: RiskAssessment;
  timestamp: number;
}

export interface PriceTick {
  price: number;
  timestamp: number;
}

export interface SpikeAlert {
  symbol: string;
  startPrice: number;
  currentPrice: number;
  changePct: number;
  windowMinutes: number;
  timestamp: number;
}

export interface CalculatorRecommendation {
  symbol: string;
  totalMargin: number;
  timeframe: '24h' | '7d';
  estimatedVolPct: number;
  maxExpectedMovePct: number;
  recommendedLeverage: number;
  distanceToLiqPct: number;
  verdict: string;
  split: {
    leg1RobinhoodLong: { margin: number; notional: number };
    leg2RobinhoodShort: { margin: number; notional: number };
    leg3PolymarketShort: { margin: number; notional: number };
  };
}

export interface AppConfig {
  defaultSymbol: string;
  pollIntervalMs: number;
  thresholds: {
    warningBufferPct: number;
    criticalBufferPct: number;
    spike1mPct: number;
    spike3mPct: number;
    spike5mPct: number;
  };
  wallets: {
    robinhoodWallet1?: string;
    robinhoodWallet2?: string;
    polymarketWallet?: string;
  };
  telegram: {
    botToken?: string;
    chatId?: string;
    criticalBotToken?: string;
  };
  hedges?: ThreeLegHedge[];
}
