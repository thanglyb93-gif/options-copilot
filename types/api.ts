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

export interface StructuralConfirmation {
  confirmed: boolean;
  referenceLabel: string;
}

export interface ContractRow {
  contractSymbol: string;
  strike: number;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  ivUnreliable: boolean;
  /** No live bid/ask because the market's closed -- lastPrice is standing in. */
  usingLastPriceFallback: boolean;
  delta: number | null;
  theta: number | null;
  inTargetBand: boolean;
  assignmentProbability: string | null;
  emCushion: number | null;
  cushionScore: number | null;
  structuralConfirmation: StructuralConfirmation | null;
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
  marketState: string | null;
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

export interface PositionSummary {
  id: string;
  ticker: string;
  position_type: "covered_call" | "cash_secured_put";
  shares_owned: number | null;
  cost_basis: number | null;
  status: "open" | "closed" | "assigned" | "expired";
}

export interface PositionsListResponse {
  positions: PositionSummary[];
}

export interface WatchlistRow {
  id: string;
  ticker: string;
  added_at: string;
}

export interface WatchlistListResponse {
  watchlist: WatchlistRow[];
}

export interface SearchMatch {
  symbol: string;
  name: string;
  quoteType: string;
}

export interface SearchResponse {
  query: string;
  matches: SearchMatch[];
}

export interface BriefingBullet {
  fact: string;
  source: string;
  impact: string;
}

export type DirectionalLean = "bullish" | "neutral" | "bearish" | "mixed";

export interface DirectionalLeanResult {
  lean: DirectionalLean;
  rationale: string;
}

export interface BriefingContent {
  bullets: BriefingBullet[];
  macro?: string;
  directionalLean: DirectionalLeanResult;
}

export interface BriefingResponse {
  ticker: string;
  content: BriefingContent;
  generatedAt: string;
  cached: boolean;
}

export interface MarketPulseResponse {
  content: BriefingContent;
  generatedAt: string;
  cached: boolean;
  headlines: NewsHeadline[];
}

export interface IvComponentResult {
  score: number | null;
  percentile: number | null;
  note?: string;
  isApproximation: boolean;
  realHistoryCount: number;
}

export interface EventComponentResult {
  catalystScore: number;
  alignmentScore: number;
  lean: string;
  rationale: string;
  opposesTradeDirection: boolean;
}

/**
 * Ticker-level entry score only (IV Percentile + Events, 0-4 partial).
 * The remaining 0-2 comes from a selected chain row's cushionScore,
 * combined client-side once a strike is picked.
 */
export interface EntryScoreResponse {
  ticker: string;
  direction: "put" | "call";
  ivComponent: IvComponentResult;
  eventComponent: EventComponentResult;
  partialTotal: number;
  asOf: string;
}

export interface WatchlistSummaryResponse {
  ticker: string;
  name: string;
  price: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  percentFrom52wHigh: number | null;
  earningsCooldownFlagged: boolean;
  hv30: number | null;
  ivHvRatio: number | null;
  ivHistory: { count: number; needed: number; hasEnoughHistory: boolean };
  asOf: string;
}
