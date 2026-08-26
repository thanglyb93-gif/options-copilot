/** Shapes returned by this app's own /api/* routes, as consumed by the UI. */

export interface AnalystTargets {
  targetHigh?: number;
  targetLow?: number;
  targetMean?: number;
  recommendationKey?: string;
  numberOfAnalysts?: number;
}

export interface QuoteResponse {
  ticker: string;
  price: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  percentFrom52wHigh: number | null;
  peRatioTrailing: number | null;
  peRatioForward: number | null;
  marketCap: number | null;
  dividendYield: number | null;
  nextExDividendDate: string | null;
  beta: number | null;
  analystTargets: AnalystTargets;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  hv30: number | null;
  asOf: string;
}

export interface ContractRow {
  contractSymbol: string;
  strike: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  ivUnreliable: boolean;
  delta: number | null;
  theta: number | null;
  inTargetBand: boolean;
}

export interface ExpirationChain {
  expirationDate: string;
  dte: number;
  calls: ContractRow[];
  puts: ContractRow[];
}

export interface OptionsResponse {
  ticker: string;
  underlyingPrice: number | null;
  frontMonthAtmIv: number | null;
  defaultExpirationIndex: number;
  expirations: ExpirationChain[];
  asOf: string;
}

export interface EarningsCooldown {
  flagged: boolean;
  percentMoveLast10TradingDays: number | null;
}

export interface EarningsResponse {
  ticker: string;
  nextEarningsDate: string | null;
  daysUntilEarnings: number | null;
  earningsCooldown: EarningsCooldown;
  asOf: string;
}

export interface NewsHeadline {
  headline: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
}

export interface NewsResponse {
  ticker: string;
  headlines: NewsHeadline[];
  asOf: string;
}

export interface MaxPainResponse {
  ticker: string;
  expirationDate: string;
  underlyingPrice: number | null;
  maxPainStrike: number | null;
  strikes: { strike: number; callOpenInterest: number; putOpenInterest: number }[];
  asOf: string;
}

export interface IvHistoryResponse {
  ticker: string;
  count: number;
  needed: number;
  hasEnoughHistory: boolean;
  ivValues: number[];
  rows: { date: string; implied_volatility_avg: number | null; trailing_30d_hv: number | null }[];
}
