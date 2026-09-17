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

/**
 * Phase 34 -- present only when the momentum-adjusted cushion buffer is
 * actually active for this contract (calls only, and only when the
 * underlying is outperforming with a healthy uptrend structure). Null
 * means no adjustment applied, same null-means-inactive convention as
 * StructuralConfirmation.
 */
export interface MomentumAdjustment {
  multiplier: number;
  reason: string;
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
  momentumAdjustment: MomentumAdjustment | null;
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
  /** Phase 35 -- % ITM (positive) or OTM (negative) vs. the strike. Null only when currentUnderlyingPrice is unavailable. */
  breachPct: number | null;
  /** Phase 35 -- true when ITM or within the "approaching breach" distance; gates whether the Roll Calculator section is shown. */
  rollEligible: boolean;
  /** Phase 36 -- only populated for a covered-call position; null for a cash-secured put (not stock-backed). */
  efficiency: PositionEfficiencyResult | null;
}

// ---------------------------------------------------------------------------
// Position Efficiency (Phase 36) -- realized annualized covered-call
// premium yield for a stock-backed holding vs. the portfolio's own
// average. See lib/position-efficiency.ts, including its KNOWN
// LIMITATION doc comment (can only see history actually logged in this
// app). A plain comparison, never a directive to sell.
// ---------------------------------------------------------------------------

export interface PositionEfficiencyResult {
  ticker: string;
  tickerYieldPct: number | null;
  portfolioAverageYieldPct: number | null;
  portfolioTickerCount: number;
  sampleSizeInsufficient: boolean;
  flagged: boolean;
  daysTracked: number;
  totalPremiumCollected: number;
  capitalCommitted: number | null;
}

// ---------------------------------------------------------------------------
// CSV trade-history import (Phase 37) -- see lib/csv-import.ts. `committed:
// false` is a dry-run preview only (nothing written); `committed: true`
// reflects what was actually just bulk-inserted.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ranking (Phase 41) -- batch Entry Score across the whole watchlist at
// a user-chosen target strike distance/expiration. See lib/ranking.ts
// and app/api/ranking/route.ts.
// ---------------------------------------------------------------------------

export interface RankingSideResult {
  score: number;
  tier: string;
  strike: number;
  expirationDate: string;
  dte: number;
}

export interface RankingCallSideResult extends RankingSideResult {
  costBasis: number | null;
  costBasisMode: "your-position" | "hypothetical";
}

export interface RankingTickerResult {
  ticker: string;
  currentPrice: number | null;
  /** ISO timestamp of this ticker's cached briefing, or null if none is cached -- Phase 42's Ranking page reads this cache-only and never generates one itself. */
  briefingGeneratedAt: string | null;
  put: RankingSideResult | null;
  putError: string | null;
  call: RankingCallSideResult | null;
  callError: string | null;
}

export interface RankingResponse {
  targetDte: number;
  callPctAbove: number;
  putPctBelow: number;
  results: RankingTickerResult[];
  asOf: string;
}

/** The union of expiration dates across every watchlisted ticker's own chain, for the Ranking page's DTE/Expiration dropdown. See app/api/ranking/expirations/route.ts. */
export interface RankingExpirationOption {
  expirationDate: string;
  dte: number;
}

export interface RankingExpirationsResponse {
  expirations: RankingExpirationOption[];
  /** Index into `expirations` closest to the app's usual 37-day default -- mirrors /api/options's own defaultExpirationIndex convention. */
  defaultIndex: number;
}

export interface CsvImportSkippedRow {
  rowNumber: number;
  raw: string[];
  reason: string;
}

export interface CsvImportUnmatchedRow {
  rowNumber: number;
  description: string;
  transCode: string;
  activityDate: string;
  unmatchedQuantity: number;
}

export interface CsvImportCandidateSummary {
  ticker: string;
  positionType: "covered_call" | "cash_secured_put";
  strike: number;
  expirationDate: string;
  openedAt: string;
  closedAt: string;
  status: "closed" | "assigned" | "expired";
  premiumCollected: number;
  closingPremium: number | null;
  realizedPl: number;
  contracts: number;
}

// ---------------------------------------------------------------------------
// Personalized Counterfactual Backtest (Phase 38) -- see lib/
// counterfactual-backtest.ts. A retrospective "what if" replaying this
// app's own current methodology (Phase 34's momentum-adjusted cushion
// buffer) against real historical prices for a user's own past LOSING
// covered-call trades -- not a guarantee the alternative would have
// been strictly better; premiumForgone is always returned alongside
// avoidedLoss.
// ---------------------------------------------------------------------------

export interface CounterfactualLegOutcome {
  strike: number;
  emCushionTarget: number;
  premiumPerShare: number;
  totalPremium: number;
  finalPrice: number;
  assigned: boolean;
  realizedPL: number;
}

export interface CounterfactualComparison {
  positionId: string;
  ticker: string;
  entryDate: string;
  expirationDate: string;
  dte: number;
  entryPrice: number;
  modeledIv: number;
  momentumMultiplier: number;
  momentumActive: boolean;
  momentumReason: string | null;
  actual: {
    strike: number;
    premiumPerShare: number;
    totalPremium: number;
    realizedPL: number;
  };
  counterfactual: CounterfactualLegOutcome;
  avoidedLoss: number;
  premiumForgone: number;
}

export interface CounterfactualSkippedPosition {
  positionId: string;
  ticker: string;
  reason: string;
}

export interface CounterfactualBacktestResponse {
  comparisons: CounterfactualComparison[];
  skipped: CounterfactualSkippedPosition[];
  asOf: string;
}

// ---------------------------------------------------------------------------
// Position news alerts (Phase 39) -- see lib/position-alerts.ts and
// app/api/check-position-alerts/route.ts. Wires the existing Finnhub
// fetch + Phase 16 classifier + Resend integration together for actual
// position monitoring rather than a new pipeline.
// ---------------------------------------------------------------------------

export interface PositionAlertCheckResult {
  ticker: string;
  matchesFound: number;
  alertsSent: number;
  duplicatesSkipped: number;
  error?: string;
}

export interface CheckPositionAlertsResponse {
  ranAt: string;
  withinMarketHours: boolean;
  forced: boolean;
  skipped: boolean;
  results: PositionAlertCheckResult[];
  totalAlertsSent: number;
}

export interface AlertLogEntry {
  id: string;
  ticker: string;
  headlineHash: string;
  sentAt: string;
}

export interface AlertLogResponse {
  alerts: AlertLogEntry[];
}

export interface CsvImportResponse {
  totalRowsParsed: number;
  skippedRows: CsvImportSkippedRow[];
  roundTripsMatched: number;
  unmatchedOpens: CsvImportUnmatchedRow[];
  unmatchedCloses: CsvImportUnmatchedRow[];
  candidatesTotal: number;
  duplicatesSkipped: number;
  duplicates: CsvImportCandidateSummary[];
  /** In both preview and commit responses: the rows that either would be, or just were, inserted. */
  toInsert: CsvImportCandidateSummary[];
  committed: boolean;
  insertedCount: number;
}

// ---------------------------------------------------------------------------
// Roll Calculator (Phase 35) -- what rolling an open position up/out
// actually costs/pays, and how much more room the new strike buys. See
// lib/roll-calculator.ts. A third option shown alongside the existing
// Hold/Close recommendation and Assignment Opportunity Cost panel, never
// a verdict of its own.
// ---------------------------------------------------------------------------

export interface RollNewPositionMetrics {
  strike: number;
  expirationDate: string;
  dte: number;
  premium: number | null;
  emCushion: number | null;
  cushionScore: number | null;
  structuralConfirmation: StructuralConfirmation | null;
  assignmentProbability: string | null;
  ivUnreliable: boolean;
  usingLastPriceFallback: boolean;
}

export interface RollPreviewResponse {
  positionId: string;
  ticker: string;
  positionType: "covered_call" | "cash_secured_put";
  underlyingPrice: number;
  currentStrike: number;
  currentExpirationDate: string;
  newStrike: number;
  newExpiration: string;
  costToCloseCurrent: number | null;
  currentContractUnreliable: boolean;
  currentUsingLastPriceFallback: boolean;
  creditFromNewContract: number | null;
  netRollCreditOrDebit: number | null;
  realizedLossOnCurrentLeg: number | null;
  newPositionMetrics: RollNewPositionMetrics | null;
  asOf: string;
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

/** Phase 43 Part C -- the no-new-API-call fallback shown when generation is capped or fails; see lib/briefing-service.ts's getBriefingRespectingDailyCap. */
export interface StructuredFactsFallback {
  /** Mechanical (non-LLM) Events sub-score, from data already gathered -- see lib/entry-score.ts's catalystRecencyScore. */
  catalystRecencyScore: number;
  /** A prior real generation's lean, however stale -- null only when none has ever been cached for this ticker. */
  cachedLean: { lean: DirectionalLean; rationale: string; generatedAt: string } | null;
}

export interface DailyGenerationStatus {
  count: number;
  cap: number;
  capHit: boolean;
}

export interface BriefingResponse {
  ticker: string;
  mode: "fresh-cache" | "generated" | "capped" | "failed";
  /** Null only in "capped"/"failed" mode -- see fallback instead. */
  content: BriefingContent | null;
  generatedAt: string | null;
  fallback: StructuredFactsFallback | null;
  dailyStatus: DailyGenerationStatus;
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
  /** False when classification failed (Anthropic error) and level/category are just a neutral fallback, not a real classification -- the UI renders these plainly, with no category tag. */
  classified: boolean;
}

export interface TodaysSummaryResponse {
  /** Null when generation failed (Anthropic error) -- headlines below are still real and unaffected. */
  content: BriefingContent | null;
  generatedAt: string | null;
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

// ---------------------------------------------------------------------------
// Timing Caution (Phase 33) -- a parallel, informational signal attached
// to the score display, never subtracted from or folded into the Entry
// Score's own math. Answers "has this settled down yet," never "what
// will happen." See lib/timing-caution.ts.
// ---------------------------------------------------------------------------

export interface TimingCautionResult {
  active: boolean;
  reasoning: string[];
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
  timingCaution: TimingCautionResult;
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
// Event Timeline (Phase 32) -- retrieval/display of past price moves and
// what coincided with them. Never predictive; see lib/event-timeline.ts.
// ---------------------------------------------------------------------------

export type EventTimelineWindow = "1w" | "1mo" | "3mo" | "1yr" | "3yr";
export type EventAnnotationType = "earnings" | "large-move" | "macro";

export interface EventAnnotation {
  ticker: string;
  date: string;
  type: EventAnnotationType;
  pctChange: number | null;
  headline: string | null;
  source: string | null;
  classification: string | null;
}

export interface EventTimelineSeriesPoint {
  date: string;
  close: number;
}

export interface EventTimelineResponse {
  ticker: string;
  window: EventTimelineWindow;
  includeMacro: boolean;
  series: EventTimelineSeriesPoint[];
  annotations: EventAnnotation[];
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
  momentumAdjustment: MomentumAdjustment | null;
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
