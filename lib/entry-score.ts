/**
 * Ticker-level entry scoring for covered calls (selling a call against
 * owned shares) and cash-secured puts (selling a put).
 *
 * Phase 40: the five components are weighted (IV/HV Percentile 3.0,
 * Technical/EM Cushion 2.5, Skew 2.0, Events 1.5, Relative Strength
 * 1.0 -- sums to 10.0) rather than an equal 2.0-each split, and each
 * one is CONTINUOUSLY interpolated between its existing threshold
 * anchors (see interpolateScore below) instead of banded into a
 * discrete bucket -- the exact same anchor arrays this app has always
 * used (IV_PERCENTILE_BANDS, SKEW_SCORE_BANDS, lib/expected-move.ts's
 * CUSHION_SCORE_BANDS), just read continuously so a value like the
 * 68th percentile scores partway between the 55th- and 70th-percentile
 * anchors instead of jumping only at those exact boundaries. Every
 * anchor array keeps producing its OLD 0-2 discrete value at the exact
 * anchor points themselves -- nothing about what "a 70th-percentile IV
 * used to score" has changed, only the values BETWEEN anchors are new.
 * That 0-2 interpolated value is then scaled to the component's new
 * weight (weight / 2.0) -- see WEIGHT_SCALE below. Events is the one
 * exception: its two sub-scores (0-0.9 catalyst recency, 0-0.6
 * directional alignment) are sized directly to their final weighted
 * range and are never scaled a second time.
 *
 * Four ticker-level components -- IV/HV Percentile, Events, Skew,
 * Relative Strength -- 0-7.5 total -- plus Technical/EM Cushion, a
 * per-strike expected-move check (lib/expected-move.ts,
 * lib/structural-levels.ts) that's added (at its own 2.5 weight) once a
 * chain row is selected, completing this to 0-10. Pure -- no API/DB
 * calls; callers gather the raw data.
 *
 * Does NOT touch lib/timing-caution.ts's Timing Caution (Phase 33) or
 * lib/active-catalysts.ts's Active/Unresolved Catalyst flag -- those
 * remain a deliberately parallel, non-scored signal, never folded into
 * this math.
 */

import { percentileRank, type VolatilitySkewLean, type VolatilitySkewResult } from "./volatility";
import type { DirectionalLean } from "./briefing";
import {
  SUITABILITY_OUTPERFORM_THRESHOLD_PCT,
  SUITABILITY_UNDERPERFORM_THRESHOLD_PCT,
  type RelativeStrengthEvaluation,
  type StructuralTrend,
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

/**
 * IV percentile anchor points, on the ORIGINAL 0-2 scale -- unchanged
 * from before Phase 40. Read continuously now (see interpolateScore)
 * rather than banded top-down into a discrete bucket, but a value
 * exactly AT one of these thresholds still scores exactly what it
 * always did; only the gaps between anchors are new.
 */
export const IV_PERCENTILE_BANDS = [
  { min: 70, score: 2.0 },
  { min: 55, score: 1.5 },
  { min: 40, score: 1.0 },
  { min: 25, score: 0.5 },
  { min: -Infinity, score: 0 },
] as const;

/** A catalyst counts as "recent" within this many days -- now the decay window for catalyst recency's smooth falloff, not a hard cutoff. */
export const CATALYST_RECENCY_WINDOW_DAYS = 14;

/** Headline count that used to grant full catalyst credit outright -- now the cap of catalyst recency's headline-count ramp (see catalystRecencyScore). */
export const CATALYST_MIN_HEADLINES = 3;

/**
 * Full-score (0-10: this module's 0-7.5 partial + a selected strike's
 * 0-2.5 weighted Technical/EM Cushion score) -> tier label. Checked
 * top-down; first satisfied band wins. Exported so the UI can apply the
 * same mapping once it combines the partial total with a selected
 * strike's cushion score. Unchanged by Phase 40's reweighting -- the
 * total range is still 0-10. Adjustable defaults.
 */
export const TIER_BANDS = [
  { min: 8, tier: "SELL (max size)" },
  { min: 6, tier: "SELL (normal size)" },
  { min: 4, tier: "CONSIDER SKIPPING" },
  { min: -Infinity, tier: "DON'T SELL" },
] as const;

/**
 * Skew magnitude (points, |putIv - callIv| * 100) anchor points, on the
 * ORIGINAL 0-2 scale -- unchanged from before Phase 40, read
 * continuously now. Applied only when the skew leans the favorable
 * direction for the trade (put-skewed for a put sale, call-skewed for
 * a call sale) -- see scoreSkewComponent.
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
// Phase 40 -- component weights (sum to 10.0) and the shared
// continuous-interpolation method every component is read through.
// ---------------------------------------------------------------------------

/** Every anchor array above/in lib/expected-move.ts was built on this original per-component scale -- weights below are expressed relative to it. */
const ORIGINAL_COMPONENT_MAX = 2.0;

export const IV_WEIGHT = 3.0;
export const TECHNICAL_WEIGHT = 2.5;
export const SKEW_WEIGHT = 2.0;
export const EVENTS_WEIGHT = 1.5;
export const RELATIVE_STRENGTH_WEIGHT = 1.0;

/** IV/HV Percentile's 0-2 interpolated value is multiplied by this to reach its new 0-3.0 weighted range. */
export const IV_SCALE = IV_WEIGHT / ORIGINAL_COMPONENT_MAX;
/** Technical/EM Cushion's 0-2 interpolated value (lib/expected-move.ts's cushionScore) is multiplied by this -- applied at combineWithStrikeCushion, not inside cushionScore itself, since that function is also reused (Roll Calculator, Simulated Backtest, Counterfactual Backtest) at its original 0-2 scale for purposes unrelated to this total. */
export const TECHNICAL_SCALE = TECHNICAL_WEIGHT / ORIGINAL_COMPONENT_MAX;
/** Skew's weight is unchanged (2.0 -> 2.0), so this is 1.0 -- interpolation still makes its values continuous, just without a range change. */
export const SKEW_SCALE = SKEW_WEIGHT / ORIGINAL_COMPONENT_MAX;
/** Relative Strength's 0-2 composite is multiplied by this to reach its new 0-1.0 weighted range. */
export const RELATIVE_STRENGTH_SCALE = RELATIVE_STRENGTH_WEIGHT / ORIGINAL_COMPONENT_MAX;

/**
 * Events is the one component that does NOT get a general-method scale
 * factor: its two sub-scores (catalystScore 0-0.9, alignmentScore 0-0.6
 * -- see scoreEventComponent) are sized directly to sum to its full
 * EVENTS_WEIGHT (1.5), so applying weight/2.0 again would double-scale.
 */

export interface ScoreAnchor {
  readonly min: number;
  readonly score: number;
}

/**
 * The one interpolation method every component above shares -- linearly
 * interpolates `value` between whichever two anchors it falls between,
 * on the anchors' own 0-2 scale, instead of banding into the discrete
 * bucket the OLD top-down first-match logic would have picked. Anchors
 * need not be pre-sorted. A non-finite (typically -Infinity) floor
 * anchor -- every band array's existing catch-all bottom entry -- is
 * treated as a FLAT score below the lowest real anchor (interpolating
 * FROM infinity is undefined, and this exactly reproduces each band
 * array's old "below the lowest real threshold" behavior); at or above
 * the highest anchor, the value is capped flat at its score, same as
 * the old top band. Anchors between the lowest and highest interpolate
 * smoothly -- exactly the boundaries that used to be sharp jumps.
 */
export function interpolateScore(value: number, anchors: readonly ScoreAnchor[]): number {
  const sorted = [...anchors].sort((a, b) => a.min - b.min);
  const floorScore = sorted[0].score;
  const finite = sorted.filter((a) => Number.isFinite(a.min));

  if (finite.length === 0) return floorScore;
  if (value < finite[0].min) return floorScore;
  if (value >= finite[finite.length - 1].min) return finite[finite.length - 1].score;

  for (let i = 0; i < finite.length - 1; i++) {
    const lower = finite[i];
    const upper = finite[i + 1];
    if (value >= lower.min && value < upper.min) {
      const t = (value - lower.min) / (upper.min - lower.min);
      return lower.score + t * (upper.score - lower.score);
    }
  }
  return finite[finite.length - 1].score;
}

/** Displayed/stored component scores round to 1 decimal place (Phase 40) -- 1.2, 1.7, 2.3 are expected now, not just 0.5 steps. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

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
  /** null when the caller has no briefing at all to read (Phase 42's Ranking cache-only path) -- scores the alignment sub-score as absent (0), not opposing. Every other caller always has a real lean here, generated or cached. */
  lean: DirectionalLean | null;
  rationale: string | null;
  daysSinceLastEarnings: number | null;
  recentHeadlineCount: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface IvComponentResult {
  /** Weighted, 0-IV_WEIGHT (3.0) -- already scaled and rounded, sums directly into partialTotal. */
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
  /** 0-0.9, mechanical (no LLM call) -- see catalystRecencyScore. */
  catalystScore: number;
  /** 0-0.6, from the briefing's LLM-derived directional lean -- see directionalAlignmentScore. */
  alignmentScore: number;
  lean: string;
  rationale: string;
  opposesTradeDirection: boolean;
}

export interface SkewComponentResult {
  /** Weighted, 0-SKEW_WEIGHT (2.0) -- unchanged range from before Phase 40, now continuous. */
  score: number | null;
  /** Raw skew result this score was derived from -- null when skew couldn't be computed (thin chain, no ~25-delta contract on one side). */
  skew: VolatilitySkewResult | null;
  note?: string;
}

export interface RelativeStrengthComponentResult {
  /** Weighted, 0-RELATIVE_STRENGTH_WEIGHT (1.0) -- already scaled and rounded. */
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
  /** IV (0-3.0) + Events (0-1.5) + Skew (0-2.0) + Relative Strength (0-1.0). Max 7.5 -- the remaining 0-2.5 comes from a selected strike's weighted cushion score. */
  partialTotal: number;
}

/** Maps a full 0-10 total to its tier label. Unchanged by Phase 40. */
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
      score: round1(interpolateScore(percentile, IV_PERCENTILE_BANDS) * IV_SCALE),
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
      score: round1(interpolateScore(hvPercentile, IV_PERCENTILE_BANDS) * IV_SCALE),
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
// Component 2 -- Events (Phase 40: two continuous sub-scores)
// ---------------------------------------------------------------------------

/** Catalyst recency's max contribution (mechanical, no LLM call). */
export const EVENTS_CATALYST_MAX = 0.9;
/** Directional alignment's max contribution (the existing LLM-derived lean). */
export const EVENTS_ALIGNMENT_MAX = 0.6;

/**
 * 0-EVENTS_CATALYST_MAX, mechanical: smooth decay from the nearest
 * relevant catalyst instead of the old binary "within 14 days = full
 * credit." Two independent signals, each ramped continuously against
 * the SAME thresholds the old binary check used
 * (CATALYST_RECENCY_WINDOW_DAYS, CATALYST_MIN_HEADLINES), combined by
 * taking whichever is currently stronger (the old logic was itself an
 * OR between them) -- no catalyst in range from either signal scores
 * exactly 0, not a missing/null state.
 */
export function catalystRecencyScore(daysSinceLastEarnings: number | null, recentHeadlineCount: number): number {
  const earningsDecay =
    daysSinceLastEarnings != null
      ? EVENTS_CATALYST_MAX * Math.max(0, 1 - daysSinceLastEarnings / CATALYST_RECENCY_WINDOW_DAYS)
      : 0;
  const headlineRamp = EVENTS_CATALYST_MAX * Math.min(1, recentHeadlineCount / CATALYST_MIN_HEADLINES);
  return round1(Math.max(earningsDecay, headlineRamp));
}

/**
 * 0-EVENTS_ALIGNMENT_MAX, from the existing briefing lean -- same
 * favorable/neutral vs. mixed vs. opposing grouping as before, just
 * rescaled from the old 0-1 range (favorable-or-neutral=1, mixed=0.5,
 * opposing=0) to the new 0-0.6 range at identical ratios (0.6, 0.3, 0).
 * opposesTradeDirection is unchanged -- still a separate, prominent UI
 * warning regardless of this score contribution.
 */
function directionalAlignmentScore(
  lean: DirectionalLean,
  favorable: DirectionalLean
): { score: number; opposesTradeDirection: boolean } {
  if (lean === favorable || lean === "neutral") return { score: EVENTS_ALIGNMENT_MAX, opposesTradeDirection: false };
  if (lean === "mixed") return { score: round1(EVENTS_ALIGNMENT_MAX * 0.5), opposesTradeDirection: false };
  return { score: 0, opposesTradeDirection: true };
}

export function scoreEventComponent(direction: TradeDirection, input: BriefingScoreInput): EventComponentResult {
  const catalystScore = catalystRecencyScore(input.daysSinceLastEarnings, input.recentHeadlineCount);

  // No briefing to read at all (Ranking's cache-only path on a cache
  // miss) -- absent, not opposing: score 0 without tripping the
  // opposesTradeDirection warning, which means "this actively opposes
  // the trade," not "we don't know."
  if (input.lean == null) {
    return {
      catalystScore,
      alignmentScore: 0,
      lean: "unavailable",
      rationale: "No cached briefing available for this ticker yet.",
      opposesTradeDirection: false,
    };
  }

  // Selling a put wants the stock to hold/rise (bullish/neutral favorable);
  // selling a call wants it to hold/fall (bearish/neutral favorable). The
  // remaining case (lean === "bearish" for a put, "bullish" for a call) is
  // the opposing lean.
  const favorable: DirectionalLean = direction === "put" ? "bullish" : "bearish";
  const { score: alignmentScore, opposesTradeDirection } = directionalAlignmentScore(input.lean, favorable);

  return {
    catalystScore,
    alignmentScore,
    lean: input.lean,
    rationale: input.rationale ?? "",
    opposesTradeDirection,
  };
}

// ---------------------------------------------------------------------------
// Component 3 -- Volatility Skew (direction-aware)
// ---------------------------------------------------------------------------

/**
 * Scores lib/volatility.ts's volatilitySkew() output, direction-aware:
 * for a put sale, put-skewed (richer put IV) is favorable -- paid more
 * premium for the exact downside risk being taken on; for a call sale,
 * call-skewed is the mirror-favorable case. Continuously interpolated
 * by magnitude (SKEW_SCORE_BANDS) when the skew leans favorable; flat
 * skew (within volatility.ts's own SKEW_FLAT_THRESHOLD) scores the
 * bottom band (0.5) regardless of direction; skew leaning against the
 * trade scores SKEW_UNFAVORABLE_SCORE (0). Null (no reading -- thin
 * chain) propagates to a null score with a note, never a fabricated
 * number.
 */
export function scoreSkewComponent(direction: TradeDirection, skew: VolatilitySkewResult | null): SkewComponentResult {
  if (skew == null) {
    return {
      score: null,
      skew: null,
      note: "Skew unavailable -- no ~25-delta contract on one side (thin chain)",
    };
  }

  const favorableLean: VolatilitySkewLean = direction === "put" ? "put-skewed" : "call-skewed";
  const pts = Math.abs(skew.skew) * 100;

  let raw: number;
  if (skew.lean === "flat") {
    raw = 0.5;
  } else if (skew.lean === favorableLean) {
    raw = interpolateScore(pts, SKEW_SCORE_BANDS);
  } else {
    raw = SKEW_UNFAVORABLE_SCORE;
  }

  return { score: round1(raw * SKEW_SCALE), skew };
}

// ---------------------------------------------------------------------------
// Component 4 -- Relative Strength (ticker-level, direction-independent)
// ---------------------------------------------------------------------------

/**
 * Continuous 0-2 read on one return-comparison axis (vs. market or vs.
 * sector), linearly interpolated between the SAME two thresholds the
 * old discrete classification used (lib/relative-strength.ts's
 * SUITABILITY_UNDERPERFORM_THRESHOLD_PCT/SUITABILITY_OUTPERFORM_THRESHOLD_PCT)
 * instead of collapsing to a positive/neutral/negative flag first. Null
 * when the axis itself has no data (e.g. no sector group defined).
 */
function axisScore(pct: number | null): number | null {
  if (pct == null) return null;
  return interpolateScore(pct, [
    { min: SUITABILITY_UNDERPERFORM_THRESHOLD_PCT, score: 0 },
    { min: SUITABILITY_OUTPERFORM_THRESHOLD_PCT, score: 2.0 },
  ]);
}

/**
 * Structural trend has no natural numeric magnitude to interpolate
 * along (it's a 3-state categorical read, not a threshold-crossing
 * metric), so it's treated as a THIRD axis on the SAME 0-2 scale as the
 * market/sector axes above -- healthy structure contributes like a
 * fully-positive axis (2.0), deteriorating like a fully-negative one
 * (0), mixed/unknown like a neutral one (1.0) -- averaged in alongside
 * them rather than acting as a separate hard gate. This reproduces the
 * old decision tree's key reference points (both axes positive + healthy
 * structure -> 2.0; both negative + deteriorating -> 0) while making
 * every value in between continuous.
 */
function structuralTrendAxisScore(trend: StructuralTrend | null): number {
  if (trend === "higher-highs-higher-lows") return 2.0;
  if (trend === "lower-highs-lower-lows") return 0;
  return 1.0; // "mixed" or unknown
}

/**
 * Averages the market axis, the structural-trend axis, and (when a
 * sector group is defined) the sector axis into one continuous 0-2
 * value, then scales to RELATIVE_STRENGTH_WEIGHT. A missing sector axis
 * is simply excluded from the average (not fabricated as neutral),
 * matching the pre-Phase-40 fallback contract: no sector data doesn't
 * silently drag the score toward "inline."
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
  const marketAxis = axisScore(w.vsMarketPct)!;
  const sectorAxis = axisScore(w.vsSectorPct);
  const structuralAxis = structuralTrendAxisScore(evaluation.structuralTrend);

  const axisValues = sectorAxis != null ? [marketAxis, sectorAxis, structuralAxis] : [marketAxis, structuralAxis];
  const raw0to2 = axisValues.reduce((a, b) => a + b, 0) / axisValues.length;

  return { score: round1(raw0to2 * RELATIVE_STRENGTH_SCALE), evaluation, sectorGroupName };
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

  const partialTotal = round1(
    (ivComponent.score ?? 0) +
      eventComponent.catalystScore +
      eventComponent.alignmentScore +
      (skewComponent.score ?? 0) +
      (relativeStrengthComponent.score ?? 0)
  );

  return { ivComponent, eventComponent, skewComponent, relativeStrengthComponent, partialTotal };
}

export interface CombinedScore {
  total: number;
  tier: string;
}

/**
 * Combines a ticker-level partial (0-7.5) with a selected strike's raw
 * 0-2 cushion score (lib/expected-move.ts's cushionScore, or null if
 * unavailable for that contract) into the full 0-10 total + tier. The
 * TECHNICAL_SCALE weighting is applied HERE, not inside cushionScore
 * itself -- that function stays on its original 0-2 scale for its other
 * callers (Roll Calculator, Simulated Backtest, Counterfactual
 * Backtest), which have nothing to do with this 0-10 total. The single
 * place this combination happens -- every UI surface showing "the
 * score" calls this rather than recomputing it, so there's no risk of
 * two numbers disagreeing.
 */
export function combineWithStrikeCushion(partialTotal: number, cushionScoreValue: number | null): CombinedScore {
  const technicalContribution = round1((cushionScoreValue ?? 0) * TECHNICAL_SCALE);
  const total = round1(partialTotal + technicalContribution);
  return { total, tier: tierForTotal(total) };
}
