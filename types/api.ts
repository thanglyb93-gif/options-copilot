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
  /** Standard 14-period RSI from daily closes. Informational only -- not an Entry Score input. */
  rsi: number | null;
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
  /** Formatted "~NN%" label, same style as assignmentProbability -- an approximation, not exact math. */
  probabilityOfTouch: string | null;
  /** Bid-ask spread as % of mid price. Null whenever there's no live two-sided market (e.g. Phase 7's market-closed lastPrice fallback) -- never a fabricated number. */
  spreadPct: number | null;
  spreadLabel: "tight" | "moderate" | "wide" | null;
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

export interface IvTermStructureResult {
  classification: "backwardation" | "contango" | "flat";
  relativeDifferencePct: number;
}

export interface VolatilitySkewResult {
  putIv: number;
  callIv: number;
  /** putIv - callIv, in decimal IV units (0.02 = 2 percentage points). */
  skew: number;
  lean: "put-skewed" | "call-skewed" | "flat";
}

export interface OptionsResponse {
  ticker: string;
  underlyingPrice: number | null;
  marketState: string | null;
  frontMonthAtmIv: number | null;
  /** Null when no expiration falls in the 60-90 DTE band for this ticker -- graceful degradation, not a broken calculation. */
  termStructure: IvTermStructureResult | null;
  /** ~25-delta put vs. call IV at the front-month expiration. Null on a thin chain with no ~25-delta contract on one side. */
  volatilitySkew: VolatilitySkewResult | null;
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

export interface ProfitHistoryPoint {
  day: number;
  profitDollars: number;
}

export interface ProfitHistoryResult {
  /** Actual reconstructed P/L, day 0 (entry) through today (inclusive) -- solid segment. */
  real: ProfitHistoryPoint[];
  /** Forward projection, today (inclusive) through expiration, price held flat -- dashed segment. */
  projected: ProfitHistoryPoint[];
}

export interface ProfitTrajectoryTodayMarker {
  day: number;
  profitDollars: number;
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

export interface AssignmentOpportunityCostPut {
  positionType: "cash_secured_put";
  ifAssigned: { effectiveCostBasis: number };
  ifCloseNow: { realizedPL: number; hypotheticalFreshBasis: number };
  costBasisDelta: number;
  capital: { capitalFreedIfCloseNow: number; ifRebuyFreshShares: number; netCashDelta: number };
  narrative: string;
  capitalNarrative: string;
}

export interface AssignmentOpportunityCostCall {
  positionType: "covered_call";
  ifAssigned: { proceeds: number; realizedGain: number };
  ifCloseNow: { realizedPL: number; sharesRetainedValue: number };
  upsideForgoneIfAssigned: number;
  capital: { cashReceivedIfAssigned: number; cashReceivedIfCloseNow: number };
  narrative: string;
  capitalNarrative: string;
}

export type AssignmentOpportunityCostResult = AssignmentOpportunityCostPut | AssignmentOpportunityCostCall;

export type ScenarioAlignmentLabel = "aligned" | "conflicting" | "insufficient";

export interface ScenarioAlignmentResult {
  trendClassification: "uptrend" | "downtrend" | "mixed" | null;
  lean: DirectionalLean;
  leanRationale: string;
  alignment: ScenarioAlignmentLabel;
  interpretation: string;
  /** Present only when a recent large earnings-driven move is active for this stock. */
  caveat?: string;
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
  /** Real (entry-to-today, from actual history) + projected (today-to-expiration, flat) $-profit-over-time. Null when an entry-time underlying price couldn't be determined. */
  profitHistory: ProfitHistoryResult | null;
  /** The chart's one real (non-theoretical) point: today's actual P/L at today's actual day-elapsed. */
  todayMarker: ProfitTrajectoryTodayMarker | null;
  /** Max profit at expiration (settlement at strike) -- the chart's "100% target" reference line. */
  maxProfit: number | null;
  closeSignal: CloseSignalResult;
  /** Only populated when the position is currently ITM. */
  itmRiskClassification: ItmRiskClassificationResult | null;
  /** Only populated when the position is meaningfully ITM (see assignmentOpportunityCost's breach gate). */
  assignmentOpportunityCost: AssignmentOpportunityCostResult | null;
  /** Only populated alongside assignmentOpportunityCost -- best-effort, null if the underlying trend/lean data couldn't be gathered. */
  scenarioAlignment: ScenarioAlignmentResult | null;
}

export interface PortfolioDeltaContribution {
  ticker: string;
  contribution: number;
}

/** Only present when there are 2+ open positions -- below that it's not meaningful. */
export interface PortfolioSummary {
  totalSpyEquivalentShares: number;
  perPosition: PortfolioDeltaContribution[];
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
  /** Only present when there are 2+ open positions. */
  portfolioSummary: PortfolioSummary | null;
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

export type AnalystActionType = "raised" | "lowered" | "maintained" | "initiated" | "other";

/** Named-firm price-target action extracted from news, distinct from QuoteResponse.analystTargets' Yahoo-aggregated consensus. */
export interface AnalystAction {
  firm: string;
  action: AnalystActionType;
  priceTarget: number | null;
  date: string;
  source: string;
}

export interface BriefingContent {
  bullets: BriefingBullet[];
  macro?: string;
  directionalLean: DirectionalLeanResult;
  analystActions: AnalystAction[];
}

export interface BriefingResponse {
  ticker: string;
  content: BriefingContent;
  generatedAt: string;
  cached: boolean;
}

export type HeadlineLevel = "macro" | "individual";

export type HeadlineCategory =
  | "monetary-policy"
  | "economic-data"
  | "geopolitical"
  | "regulatory"
  | "earnings"
  | "M&A-buyback"
  | "analyst-action"
  | "executive-change"
  | "partnership"
  | "notable-investor-move"
  | "new-to-watch"
  | "other";

export interface ClassifiedNewsHeadline extends NewsHeadline {
  id: string;
  level: HeadlineLevel;
  category: HeadlineCategory;
}

export interface TodaysSummaryResponse {
  content: BriefingContent;
  generatedAt: string;
  cached: boolean;
  /** All fetched headlines, classified, most-recent-first. */
  headlines: ClassifiedNewsHeadline[];
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

export interface SkewComponentResult {
  score: number | null;
  skew: VolatilitySkewResult | null;
  note?: string;
}

export interface RelativeStrengthComponentResult {
  score: number | null;
  evaluation: RelativeStrengthEvaluation | null;
  sectorGroupName: string | null;
  note?: string;
}

/**
 * Ticker-level entry score only (IV Percentile + Events + Skew +
 * Relative Strength, 0-8 partial). The remaining 0-2 comes from a
 * selected chain row's cushionScore, combined client-side once a strike
 * is picked.
 */
export interface EntryScoreResponse {
  ticker: string;
  direction: "put" | "call";
  ivComponent: IvComponentResult;
  eventComponent: EventComponentResult;
  skewComponent: SkewComponentResult;
  relativeStrengthComponent: RelativeStrengthComponentResult;
  partialTotal: number;
  asOf: string;
}

export interface IvRankSummary {
  /** Real iv_history rows collected so far for this ticker. */
  count: number;
  /** Rows needed before a real percentile replaces the HV Percentile fallback display. */
  needed: number;
  /** Real IV Percentile -- null until count >= needed. */
  percentile: number | null;
  /**
   * HV Percentile -- always computed when available (independent of IV
   * maturity), so the Dashboard card has a real number to show instead
   * of a meaningless "Nd/needed" placeholder for the weeks before IV
   * Percentile matures. Same calculation the ticker Overview's HV
   * Percentile stat uses.
   */
  hvPercentile: number | null;
}

export interface WatchlistSummaryResponse {
  ticker: string;
  name: string;
  price: number | null;
  dayChangePercent: number | null;
  ivRank: IvRankSummary;
  /** Same nearest-expiration max-pain calculation as /api/maxpain. */
  maxPainStrike: number | null;
  /** Put OI / call OI across the nearest expiration's chain. Null when there's no call OI to divide by. */
  putCallRatio: number | null;
  asOf: string;
}

export interface RelativeStrengthWindow {
  lookbackDays: number;
  tickerReturnPct: number | null;
  spyReturnPct: number | null;
  vsMarketPct: number | null;
  sectorReturnPct: number | null;
  vsSectorPct: number | null;
}

export type StructuralTrend = "higher-highs-higher-lows" | "lower-highs-lower-lows" | "mixed";
export type Suitability = "outperforming" | "inline" | "underperforming";

export interface RelativeStrengthEvaluation {
  ticker: string;
  window30: RelativeStrengthWindow;
  window90: RelativeStrengthWindow;
  window180: RelativeStrengthWindow;
  structuralTrend: StructuralTrend | null;
  suitability: Suitability;
}

export interface ScreenerSectorGroup {
  name: string;
  peers: string[];
  benchmarkEtf: string;
}

export interface ScreenerResponse {
  ticker: string;
  name: string;
  price: number | null;
  dayChangePercent: number | null;
  evaluation: RelativeStrengthEvaluation;
  /** Null when this ticker has no defined sector group -- broad-market-only comparison, not an error. */
  sectorGroup: ScreenerSectorGroup | null;
  summary: string;
  /**
   * Phase 29: same ~25-delta put-vs-call IV read as the ticker page's
   * Volatility Skew (lib/volatility.ts), computed from the front-month
   * expiration. Null on a thin chain with no ~25-delta contract on one
   * side -- same graceful-degradation contract as everywhere else this
   * is shown.
   */
  volatilitySkew: VolatilitySkewResult | null;
  asOf: string;
}

// ---------------------------------------------------------------------------
// Simulated historical backtest (Phase 29) -- SIMULATED: real historical
// prices, but modeled IV/premiums, since no free source provides real
// historical option prices. Every UI surface for this data must say so.
// ---------------------------------------------------------------------------

export interface SimulatedEntry {
  entryDate: string;
  entryPrice: number;
  modeledIv: number;
  strike: number;
  expirationDate: string;
  dte: number;
  premiumPerShare: number;
  totalPremium: number;
  finalPrice: number;
  assigned: boolean;
  capitalAtRisk: number;
  realizedPL: number;
  returnPct: number;
}

export interface SimulatedBacktestResponse {
  ticker: string;
  direction: "put" | "call";
  lookbackMonths: number;
  targetDte: number;
  targetCushion: number;
  entries: SimulatedEntry[];
  winRate: number | null;
  avgReturnPct: number | null;
  bestEntry: SimulatedEntry | null;
  worstEntry: SimulatedEntry | null;
  asOf: string;
}

// ---------------------------------------------------------------------------
// Insider activity -- SEC EDGAR Form 4 (Phase 29)
// ---------------------------------------------------------------------------

export type InsiderTransactionCode = "P" | "S";

export interface InsiderTransaction {
  insiderName: string;
  role: string;
  code: InsiderTransactionCode;
  shares: number;
  pricePerShare: number;
  valueUsd: number;
  transactionDate: string;
}

export interface InsiderActivitySummary {
  ticker: string;
  windowDays: number;
  purchaseCount: number;
  saleCount: number;
  netValueUsd: number;
  totalBoughtUsd: number;
  totalSoldUsd: number;
  recentTransactions: InsiderTransaction[];
}

export interface InsiderActivityResponse {
  ticker: string;
  /** Null when SEC has no CIK for this ticker (not a US reporting company) -- distinct from real zero-activity. */
  summary: InsiderActivitySummary | null;
  generatedAt: string;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Covered Call vs. Cash-Secured Put comparison (Phase 26)
// ---------------------------------------------------------------------------

export interface ComparisonSideResult {
  strike: number;
  dte: number;
  expirationDate: string;
  premium: number | null;
  capitalRequired: number;
  annualizedYieldOnCapital: number | null;
  assignmentProbability: string | null;
  probabilityOfTouch: string | null;
  emCushion: number | null;
  cushionScore: number | null;
  structuralConfirmation: StructuralConfirmation | null;
  spreadPct: number | null;
  spreadLabel: "tight" | "moderate" | "wide" | null;
  skewComponent: SkewComponentResult;
  /** Call side only. Null for the put side. */
  worstCaseRealizedGain: number | null;
  /** Call side only. Null for the put side. */
  upsideForgoneEstimate: number | null;
  /** Put side only. Null for the call side. */
  worstCaseEffectiveBasis: number | null;
}

export type DirectionalEdge = "bullish" | "bearish" | "unclear";

/** "your-position": a real tracked open position with shares_owned > 0 exists -- costBasis is that position's actual (share-weighted) cost basis, never editable. "hypothetical": no such position exists -- costBasis is a what-if figure (defaults to underlyingPrice, editable client-side). */
export type ComparisonMode = "your-position" | "hypothetical";

export interface ComparisonResponse {
  ticker: string;
  mode: ComparisonMode;
  underlyingPrice: number;
  /** "your-position" mode: share-weighted average across every open position with shares_owned > 0 -- the real tracked position, never a manual override. "hypothetical" mode: a what-if figure, defaults to underlyingPrice, overridable via the hypotheticalCostBasis query param. */
  costBasis: number;
  sharesOwned: number;
  /** Same contracts count used on both sides -- sized to what the owned shares actually cover. */
  contracts: number;
  putSide: ComparisonSideResult;
  callSide: ComparisonSideResult;
  trend: "uptrend" | "downtrend" | "mixed" | null;
  trendDescription: string;
  /** Same template sentence the Screener and ticker Overview show for this ticker. */
  relativeStrengthSummary: string;
  directionalEdge: DirectionalEdge;
  ninetyDayRange: { high: number; low: number } | null;
  asOf: string;
}
