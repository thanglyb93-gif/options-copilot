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
  /** Percentile rank of current 30d HV against its own trailing ~1yr distribution -- available immediately, no accumulation period. */
  hvPercentile: number | null;
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

export interface DecayCurvePoint {
  dte: number;
  theoreticalValue: number;
}

export interface CloseSignalResult {
  shouldClose: boolean;
  reason: string | null;
}

export interface ItmRiskClassificationResult {
  classification: "sell-the-news" | "real-breakdown" | "unclear";
  recommendedAction: "hold" | "close" | "monitor";
  reasoning: string[];
  breachPct: number;
}

/** Live analytics for an OPEN position -- null/omitted for closed positions, which don't need them. */
export interface PositionAnalytics {
  dte: number;
  currentUnderlyingPrice: number | null;
  /** Reference price per share for the option today -- respects Phase 7's market-hours fallback (null only when genuinely unreliable). */
  currentContractValue: number | null;
  usingLastPriceFallback: boolean;
  contractUnreliable: boolean;
  stockPL: number | null;
  optionLegPL: number | null;
  /** The headline number: stock leg + option leg combined. Never surface optionLegPL alone as if it's the whole picture. */
  netCoveredPL: number | null;
  profitCapturedPct: number | null;
  decayCurve: DecayCurvePoint[];
  closeSignal: CloseSignalResult;
  /** Only populated when the position is currently ITM. */
  itmRiskClassification: ItmRiskClassificationResult | null;
}

export interface PositionSummary {
  id: string;
  ticker: string;
  position_type: "covered_call" | "cash_secured_put";
  shares_owned: number | null;
  cost_basis: number | null;
  strike: number;
  premium_collected: number;
  expiration_date: string;
  contracts: number;
  status: "open" | "closed" | "assigned" | "expired";
  opened_at: string;
  closed_at: string | null;
  closing_premium: number | null;
  realized_pl: number | null;
  /** Populated only for status === "open". */
  analytics: PositionAnalytics | null;
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
  hvPercentile: number | null;
  note?: string;
  isApproximation: boolean;
  realHistoryCount: number;
}

export interface IvHistoryGap {
  ticker: string;
  missingDates: string[];
  expectedCount: number;
  collectedCount: number;
}

export interface IvHealthResponse {
  healthy: boolean;
  gaps: IvHistoryGap[];
  checkedAt: string;
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
