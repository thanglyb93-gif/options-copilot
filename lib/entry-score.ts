/**
 * Ticker-level entry scoring for covered calls (selling a call against
 * owned shares) and cash-secured puts (selling a put). Two components,
 * 0-2 pts each, 0-4 total -- Technical Setup moved to a per-strike
 * expected-move check (lib/expected-move.ts, lib/structural-levels.ts)
 * that's added to this partial total once a chain row is selected,
 * completing it to 0-6. Pure -- no API/DB calls; callers gather the raw
 * data.
 */

import { percentileRank } from "./volatility";
import type { DirectionalLean } from "./briefing";

export type TradeDirection = "put" | "call";

// ---------------------------------------------------------------------------
// Adjustable thresholds -- named constants so tuning doesn't mean hunting
// for magic numbers scattered through the scoring functions below.
// ---------------------------------------------------------------------------

/** Minimum iv_history rows before a percentile is considered meaningful. */
const IV_HISTORY_MIN_ROWS = 20;

/** IV percentile -> score. Checked top-down; first satisfied band wins. */
const IV_PERCENTILE_BANDS = [
  { min: 70, score: 2.0 },
  { min: 55, score: 1.5 },
  { min: 40, score: 1.0 },
  { min: 25, score: 0.5 },
  { min: -Infinity, score: 0 },
] as const;

/** A catalyst counts as "recent" within this many days. */
const CATALYST_RECENCY_WINDOW_DAYS = 14;

/** Headline count that counts as a catalyst on its own, absent recent earnings. */
const CATALYST_MIN_HEADLINES = 3;

/**
 * Full-score (0-6: this module's 0-4 partial + a selected strike's 0-2
 * cushion score) -> tier label. Checked top-down; first satisfied band
 * wins. Exported so the UI can apply the same mapping once it combines
 * the partial total with a selected strike's cushion score.
 */
export const TIER_BANDS = [
  { min: 4.5, tier: "SELL (max size)" },
  { min: 3, tier: "SELL (normal size)" },
  { min: 1.5, tier: "CONSIDER SKIPPING" },
  { min: -Infinity, tier: "DON'T SELL" },
] as const;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface IvPercentileInput {
  currentIv: number | null;
  historicalValues: number[];
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
  percentile: number | null;
  note?: string;
}

export interface EventComponentResult {
  catalystScore: number;
  alignmentScore: number;
  lean: string;
  rationale: string;
  opposesTradeDirection: boolean;
}

export interface TickerLevelScoreResult {
  ivComponent: IvComponentResult;
  eventComponent: EventComponentResult;
  /** IV component (0-2, or 0 if unavailable) + Events (0-2). Max 4 -- the remaining 0-2 comes from a selected strike's cushion score. */
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
  if (input.historicalValues.length < IV_HISTORY_MIN_ROWS) {
    return {
      score: null,
      percentile: null,
      note: `Building history (${input.historicalValues.length}/${IV_HISTORY_MIN_ROWS} days)`,
    };
  }
  if (input.currentIv == null) {
    return { score: null, percentile: null, note: "Current IV unavailable" };
  }

  const percentile = percentileRank(input.currentIv, input.historicalValues);
  if (percentile == null) {
    return { score: null, percentile: null, note: "Current IV unavailable" };
  }

  return { score: bandIvPercentile(percentile), percentile };
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
// Combined ticker-level score (partial -- see module doc)
// ---------------------------------------------------------------------------

export function scoreTickerLevel(
  direction: TradeDirection,
  ivPercentileData: IvPercentileInput,
  briefingData: BriefingScoreInput
): TickerLevelScoreResult {
  const ivComponent = scoreIvComponent(ivPercentileData);
  const eventComponent = scoreEventComponent(direction, briefingData);

  const partialTotal =
    (ivComponent.score ?? 0) + eventComponent.catalystScore + eventComponent.alignmentScore;

  return { ivComponent, eventComponent, partialTotal };
}
