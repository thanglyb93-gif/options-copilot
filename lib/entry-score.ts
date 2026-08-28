/**
 * Ticker-level entry scoring for covered calls (selling a call against
 * owned shares) and cash-secured puts (selling a put). Four ticker-level
 * components -- IV/HV Percentile, Events, Skew, Relative Strength -- 0-2
 * pts each, 0-8 total -- plus Technical Setup, a per-strike
 * expected-move check (lib/expected-move.ts, lib/structural-levels.ts)
 * that's added to this partial total once a chain row is selected,
 * completing it to 0-10. Pure -- no API/DB calls; callers gather the raw
 * data.
 */

import { percentileRank, type VolatilitySkewLean, type VolatilitySkewResult } from "./volatility";
import type { DirectionalLean } from "./briefing";
import {
  SUITABILITY_OUTPERFORM_THRESHOLD_PCT,
  SUITABILITY_UNDERPERFORM_THRESHOLD_PCT,
  type RelativeStrengthEvaluation,
} from "./relative-strength";

export type TradeDirection = "put" | "call";

// ---------------------------------------------------------------------------
// Adjustable thresholds -- named constants so tuning doesn't mean hunting
// for magic numbers scattered through the scoring functions below.
// ---------------------------------------------------------------------------

/**
 * Exported (not just internal): lib/guidance-content.ts generates the
 * Guidance page's threshold descriptions directly from these constants,
 * so they're the single source of truth -- change a value here and the
 * displayed text changes with it, no separate prose to keep in sync.
 */

/** Minimum iv_history rows before a real IV percentile is considered meaningful. */
export const IV_HISTORY_MIN_ROWS = 20;

/** Minimum rolling-HV samples before the HV-based approximation is trusted. */
export const HV_FALLBACK_MIN_SAMPLES = 30;

/** IV percentile -> score. Checked top-down; first satisfied band wins. */
export const IV_PERCENTILE_BANDS = [
  { min: 70, score: 2.0 },
  { min: 55, score: 1.5 },
  { min: 40, score: 1.0 },
  { min: 25, score: 0.5 },
  { min: -Infinity, score: 0 },
] as const;

/** A catalyst counts as "recent" within this many days. */
export const CATALYST_RECENCY_WINDOW_DAYS = 14;

/** Headline count that counts as a catalyst on its own, absent recent earnings. */
export const CATALYST_MIN_HEADLINES = 3;

/**
 * Full-score (0-10: this module's 0-8 partial + a selected strike's 0-2
 * cushion score) -> tier label. Checked top-down; first satisfied band
 * wins. Exported so the UI can apply the same mapping once it combines
 * the partial total with a selected strike's cushion score. Adjustable
 * defaults.
 */
export const TIER_BANDS = [
  { min: 8, tier: "SELL (max size)" },
  { min: 6, tier: "SELL (normal size)" },
  { min: 4, tier: "CONSIDER SKIPPING" },
  { min: -Infinity, tier: "DON'T SELL" },
] as const;

/**
 * Skew magnitude (points, |putIv - callIv| * 100) -> score, applied only
 * when the skew leans the favorable direction for the trade (put-skewed
 * for a put sale, call-skewed for a call sale) -- see
 * scoreSkewComponent. Checked top-down; first satisfied band wins.
 * Adjustable defaults.
 */
export const SKEW_SCORE_BANDS = [
  { min: 6, score: 2.0 },
  { min: 4, score: 1.5 },
  { min: 2, score: 1.0 },
  { min: -Infinity, score: 0.5 },
] as const;

/** Score when the skew leans against the trade direction (working against you, not for it). */
export const SKEW_UNFAVORABLE_SCORE = 0;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface IvPercentileInput {
  currentIv: number | null;
  historicalValues: number[];
  /**
   * Approximate stand-in used only while historicalValues has fewer than
   * IV_HISTORY_MIN_ROWS entries -- ranks today's 30d HV against a rolling
   * distribution of trailing HV built purely from daily closes (see
   * lib/volatility.ts's rollingHistoricalVolatility), so there's a
   * reasonable signal from day one instead of a dead "building history"
   * state for 20 real calendar days.
   */
  hvFallback?: {
    currentHv: number | null;
    hvSeries: number[];
  };
}

export interface BriefingScoreInput {
  lean: DirectionalLean;
  rationale: string;
  daysSinceLastEarnings: number | null;
  recentHeadlineCount: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface IvComponentResult {
  score: number | null;
  /** Real IV Percentile -- null until IV_HISTORY_MIN_ROWS real iv_history rows exist. */
  percentile: number | null;
  /**
   * HV Percentile -- a real, independent metric computed purely from
   * daily closes, always present when computable (regardless of which
   * one is driving `score`). Shown permanently alongside IV Percentile,
   * not just while IV is immature -- a divergence between the two is
   * itself useful signal.
   */
  hvPercentile: number | null;
  note?: string;
  /** True when `score` is driven by HV Percentile, not real IV Percentile. */
  isApproximation: boolean;
  /** Real iv_history row count, regardless of which path produced the score -- lets the UI show "N/20" progress even while HV Percentile is driving the score. */
  realHistoryCount: number;
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
  /** Raw skew result this score was derived from -- null when skew couldn't be computed (thin chain, no ~25-delta contract on one side). */
  skew: VolatilitySkewResult | null;
  note?: string;
}

export interface RelativeStrengthComponentResult {
  score: number | null;
  /** Full evaluation this score was derived from -- null when there wasn't enough price history to compute it. */
  evaluation: RelativeStrengthEvaluation | null;
  /** Peer group name, for display (e.g. "vs Semiconductors peers") -- null when the ticker has no defined sector group. */
  sectorGroupName: string | null;
  note?: string;
}

export interface TickerLevelScoreResult {
  ivComponent: IvComponentResult;
  eventComponent: EventComponentResult;
  skewComponent: SkewComponentResult;
  relativeStrengthComponent: RelativeStrengthComponentResult;
  /** IV (0-2) + Events (0-2) + Skew (0-2) + Relative Strength (0-2). Max 8 -- the remaining 0-2 comes from a selected strike's cushion score. */
  partialTotal: number;
}

// ---------------------------------------------------------------------------
// Banding helpers
// ---------------------------------------------------------------------------

function bandIvPercentile(percentile: number): number {
  for (const band of IV_PERCENTILE_BANDS) {
    if (percentile >= band.min) return band.score;
  }
  return 0;
}

/** Maps a full 0-6 total to its tier label. */
export function tierForTotal(total: number): string {
  for (const band of TIER_BANDS) {
    if (total >= band.min) return band.tier;
  }
  return TIER_BANDS[TIER_BANDS.length - 1].tier;
}

// ---------------------------------------------------------------------------
// Component 1 -- IV percentile
// ---------------------------------------------------------------------------

export function scoreIvComponent(input: IvPercentileInput): IvComponentResult {
  const realCount = input.historicalValues.length;

  // HV Percentile is always computed, independent of which path drives
  // the score -- it's a permanent, standalone indicator now, not just a
  // fallback for when IV is immature.
  const fallback = input.hvFallback;
  const hvPercentile =
    fallback?.currentHv != null && fallback.hvSeries.length >= HV_FALLBACK_MIN_SAMPLES
      ? percentileRank(fallback.currentHv, fallback.hvSeries)
      : null;

  if (realCount >= IV_HISTORY_MIN_ROWS) {
    if (input.currentIv == null) {
      return {
        score: null,
        percentile: null,
        hvPercentile,
        note: "Current IV unavailable",
        isApproximation: false,
        realHistoryCount: realCount,
      };
    }
    const percentile = percentileRank(input.currentIv, input.historicalValues);
    if (percentile == null) {
      return {
        score: null,
        percentile: null,
        hvPercentile,
        note: "Current IV unavailable",
        isApproximation: false,
        realHistoryCount: realCount,
      };
    }
    return {
      score: bandIvPercentile(percentile),
      percentile,
      hvPercentile,
      isApproximation: false,
      realHistoryCount: realCount,
    };
  }

  // Fewer than IV_HISTORY_MIN_ROWS real rows -- HV Percentile drives the
  // score instead, clearly labeled as such (see isApproximation).
  if (hvPercentile != null) {
    return {
      score: bandIvPercentile(hvPercentile),
      percentile: null,
      hvPercentile,
      note: `IV still building history (${realCount}/${IV_HISTORY_MIN_ROWS} days) -- score based on HV Percentile`,
      isApproximation: true,
      realHistoryCount: realCount,
    };
  }

  return {
    score: null,
    percentile: null,
    hvPercentile: null,
    note: `Building history (${realCount}/${IV_HISTORY_MIN_ROWS} days)`,
    isApproximation: false,
    realHistoryCount: realCount,
  };
}

// ---------------------------------------------------------------------------
// Component 2 -- catalyst recency + directional alignment
// ---------------------------------------------------------------------------

export function scoreEventComponent(
  direction: TradeDirection,
  input: BriefingScoreInput
): EventComponentResult {
  const catalystScore =
    input.daysSinceLastEarnings != null && input.daysSinceLastEarnings <= CATALYST_RECENCY_WINDOW_DAYS
      ? 1
      : input.recentHeadlineCount >= CATALYST_MIN_HEADLINES
        ? 1
        : 0;

  // Selling a put wants the stock to hold/rise (bullish/neutral favorable);
  // selling a call wants it to hold/fall (bearish/neutral favorable). The
  // remaining case (lean === "bearish" for a put, "bullish" for a call) is
  // the opposing lean.
  const favorable: DirectionalLean = direction === "put" ? "bullish" : "bearish";

  let alignmentScore: number;
  let opposesTradeDirection = false;

  if (input.lean === favorable || input.lean === "neutral") {
    alignmentScore = 1;
  } else if (input.lean === "mixed") {
    alignmentScore = 0.5;
  } else {
    alignmentScore = 0;
    opposesTradeDirection = true;
  }

  return {
    catalystScore,
    alignmentScore,
    lean: input.lean,
    rationale: input.rationale,
    opposesTradeDirection,
  };
}

// ---------------------------------------------------------------------------
// Component 3 -- Volatility Skew (direction-aware)
// ---------------------------------------------------------------------------

function bandSkewMagnitude(pts: number): number {
  for (const band of SKEW_SCORE_BANDS) {
    if (pts >= band.min) return band.score;
  }
  return SKEW_SCORE_BANDS[SKEW_SCORE_BANDS.length - 1].score;
}

/**
 * Scores lib/volatility.ts's volatilitySkew() output, direction-aware:
 * for a put sale, put-skewed (richer put IV) is favorable -- paid more
 * premium for the exact downside risk being taken on; for a call sale,
 * call-skewed is the mirror-favorable case. Banded by magnitude
 * (SKEW_SCORE_BANDS) when the skew leans favorable; flat skew (within
 * volatility.ts's own SKEW_FLAT_THRESHOLD) scores the bottom band (0.5)
 * regardless of direction; skew leaning against the trade scores
 * SKEW_UNFAVORABLE_SCORE (0). Null (no reading -- thin chain) propagates
 * to a null score with a note, never a fabricated number.
 */
export function scoreSkewComponent(
  direction: TradeDirection,
  skew: VolatilitySkewResult | null
): SkewComponentResult {
  if (skew == null) {
    return {
      score: null,
      skew: null,
      note: "Skew unavailable -- no ~25-delta contract on one side (thin chain)",
    };
  }

  const favorableLean: VolatilitySkewLean = direction === "put" ? "put-skewed" : "call-skewed";
  const pts = Math.abs(skew.skew) * 100;

  let score: number;
  if (skew.lean === "flat") {
    score = 0.5;
  } else if (skew.lean === favorableLean) {
    score = bandSkewMagnitude(pts);
  } else {
    score = SKEW_UNFAVORABLE_SCORE;
  }

  return { score, skew };
}

// ---------------------------------------------------------------------------
// Component 4 -- Relative Strength (ticker-level, direction-independent)
// ---------------------------------------------------------------------------

type MetricState = "positive" | "neutral" | "negative";

/**
 * Classifies a vs-market/vs-sector delta into positive/neutral/negative,
 * reusing the exact thresholds the Screener's suitability label is
 * judged on (lib/relative-strength.ts) rather than a second, competing
 * set of numbers. Null (no data -- e.g. no sector group defined for this
 * ticker) is treated as neutral, matching the Screener's own null-safe
 * convention: missing sector data doesn't drag the score down, but it
 * also can't itself satisfy the top band's "both positive" requirement.
 */
function metricState(pct: number | null): MetricState {
  if (pct == null) return "neutral";
  if (pct > SUITABILITY_OUTPERFORM_THRESHOLD_PCT) return "positive";
  if (pct < SUITABILITY_UNDERPERFORM_THRESHOLD_PCT) return "negative";
  return "neutral";
}

/**
 * Scores lib/relative-strength.ts's 180-day (primary window) evaluation
 * -- vsMarket, vsSector (when available), and the longer structural
 * trend. Checked top-down; first satisfied condition wins:
 * - both vsMarket and vsSector clearly positive + healthy structure -> 2.0
 * - both clearly negative + deteriorating structure -> 0
 * - either clearly negative -> 0.5
 * - at least one clearly positive and structure isn't deteriorating -> 1.5
 * - otherwise (both roughly inline, or a positive read undercut by a
 *   deteriorating structure) -> 1.0
 * Ticker-level, same as IV and Events -- identical for the put and call
 * score requests for a given ticker.
 */
export function scoreRelativeStrengthComponent(
  evaluation: RelativeStrengthEvaluation | null,
  sectorGroupName: string | null
): RelativeStrengthComponentResult {
  if (evaluation == null || evaluation.window180.vsMarketPct == null) {
    return {
      score: null,
      evaluation,
      sectorGroupName,
      note: "Not enough price history to compute relative strength",
    };
  }

  const w = evaluation.window180;
  const marketState = metricState(w.vsMarketPct);
  const sectorState = metricState(w.vsSectorPct);
  const healthyStructure = evaluation.structuralTrend === "higher-highs-higher-lows";
  const deterioratingStructure = evaluation.structuralTrend === "lower-highs-lower-lows";

  const positiveCount = [marketState, sectorState].filter((s) => s === "positive").length;
  const negativeCount = [marketState, sectorState].filter((s) => s === "negative").length;

  let score: number;
  if (positiveCount === 2 && healthyStructure) {
    score = 2.0;
  } else if (negativeCount === 2 && deterioratingStructure) {
    score = 0;
  } else if (negativeCount >= 1) {
    score = 0.5;
  } else if (positiveCount >= 1 && !deterioratingStructure) {
    score = 1.5;
  } else {
    score = 1.0;
  }

  return { score, evaluation, sectorGroupName };
}

// ---------------------------------------------------------------------------
// Combined ticker-level score (partial -- see module doc)
// ---------------------------------------------------------------------------

export function scoreTickerLevel(
  direction: TradeDirection,
  ivPercentileData: IvPercentileInput,
  briefingData: BriefingScoreInput,
  skewData: VolatilitySkewResult | null,
  relativeStrengthData: { evaluation: RelativeStrengthEvaluation | null; sectorGroupName: string | null }
): TickerLevelScoreResult {
  const ivComponent = scoreIvComponent(ivPercentileData);
  const eventComponent = scoreEventComponent(direction, briefingData);
  const skewComponent = scoreSkewComponent(direction, skewData);
  const relativeStrengthComponent = scoreRelativeStrengthComponent(
    relativeStrengthData.evaluation,
    relativeStrengthData.sectorGroupName
  );

  const partialTotal =
    (ivComponent.score ?? 0) +
    eventComponent.catalystScore +
    eventComponent.alignmentScore +
    (skewComponent.score ?? 0) +
    (relativeStrengthComponent.score ?? 0);

  return { ivComponent, eventComponent, skewComponent, relativeStrengthComponent, partialTotal };
}

export interface CombinedScore {
  total: number;
  tier: string;
}

/**
 * Combines a ticker-level partial (0-8) with a selected strike's cushion
 * score (0-2, or null if unavailable for that contract) into the full
 * 0-10 total + tier. The single place this combination happens -- every
 * UI surface showing "the score" calls this rather than recomputing it,
 * so there's no risk of two numbers disagreeing.
 */
export function combineWithStrikeCushion(
  partialTotal: number,
  cushionScoreValue: number | null
): CombinedScore {
  const total = partialTotal + (cushionScoreValue ?? 0);
  return { total, tier: tierForTotal(total) };
}
