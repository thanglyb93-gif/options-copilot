/**
 * Plain-language labels for entry-time indicators that otherwise show
 * only a raw number with no context for whether it's good, moderate, or
 * risky. Every threshold is sourced from constants that already exist
 * elsewhere (lib/entry-score.ts, lib/expected-move.ts) -- this module
 * never redefines a threshold used for scoring, it only maps the exact
 * same bands to a label. The two genuinely new threshold sets here
 * (Assignment/Touch probability risk bands, the IV/HV ratio outlier
 * bounds) are informational only -- neither feeds the Entry Score.
 */

import { IV_PERCENTILE_BANDS } from "./entry-score";
import { CUSHION_SCORE_BANDS } from "./expected-move";
import type { VolatilitySkewLean } from "./volatility";

// ---------------------------------------------------------------------------
// EM Cushion -- reuses CUSHION_SCORE_BANDS (lib/expected-move.ts) exactly.
// ---------------------------------------------------------------------------

/** Same order as CUSHION_SCORE_BANDS (highest min first). */
export const CUSHION_LABELS = ["Very Wide", "Wide", "Moderate", "Tight", "Thin"] as const;

export function cushionLabel(emMultiple: number): string {
  for (let i = 0; i < CUSHION_SCORE_BANDS.length; i++) {
    if (emMultiple >= CUSHION_SCORE_BANDS[i].min) return CUSHION_LABELS[i];
  }
  return CUSHION_LABELS[CUSHION_LABELS.length - 1];
}

// ---------------------------------------------------------------------------
// IV Percentile / HV Percentile -- reuses IV_PERCENTILE_BANDS
// (lib/entry-score.ts). Same 5-band thresholds label either percentile,
// since both are "where does this sit against its own history" reads.
// ---------------------------------------------------------------------------

/** Same order as IV_PERCENTILE_BANDS (highest min first). */
export const PERCENTILE_LABELS = ["Rich", "Elevated", "Average", "Below Average", "Low"] as const;

export function percentileLabel(percentile: number): string {
  for (let i = 0; i < IV_PERCENTILE_BANDS.length; i++) {
    if (percentile >= IV_PERCENTILE_BANDS[i].min) return PERCENTILE_LABELS[i];
  }
  return PERCENTILE_LABELS[PERCENTILE_LABELS.length - 1];
}

// ---------------------------------------------------------------------------
// Assignment Probability / Probability of Touch -- these have no
// existing Entry Score thresholds (they're informational, not scored
// inputs), so these bands are new, named, and defined once here. A
// higher reading isn't inherently "bad" -- it usually comes with richer
// premium -- so this is a risk-level label, not a verdict.
// ---------------------------------------------------------------------------

/** Checked top-down; first satisfied band wins. Percent, 0-100 scale. */
export const RISK_PROBABILITY_BANDS = [
  { min: 50, label: "High Risk" },
  { min: 30, label: "Elevated" },
  { min: 15, label: "Moderate" },
  { min: -Infinity, label: "Conservative" },
] as const;

export const RISK_PROBABILITY_NOTE =
  "Higher probability often comes with richer premium -- a risk-level label, not a verdict that higher is bad.";

export function riskProbabilityLabel(percent: number): string {
  for (const band of RISK_PROBABILITY_BANDS) {
    if (percent >= band.min) return band.label;
  }
  return RISK_PROBABILITY_BANDS[RISK_PROBABILITY_BANDS.length - 1].label;
}

/**
 * Assignment Probability and Probability of Touch are stored/displayed
 * as pre-formatted "~NN%" strings (lib/options-math.ts's
 * assignmentProbabilityLabel / the probabilityOfTouch formatting in
 * app/api/options), not raw numbers -- this recovers the number for
 * banding purposes without touching that formatting or recomputing
 * anything.
 */
export function parseApproxPercent(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(-?\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Volatility skew -- reuses lib/volatility.ts's own lean classification
// (put-skewed/call-skewed/flat), just formatted as the same pill label
// used everywhere else in Phase 28's labeling work. Shared by the Entry
// Score card (components/ticker/entry-score-panel.tsx) and the
// Screener's new Skew stat (Phase 29) so the two surfaces can never
// show different wording for the same lean.
// ---------------------------------------------------------------------------

export function skewLeanLabel(lean: VolatilitySkewLean): string {
  return lean === "put-skewed" ? "Put-Skewed" : lean === "call-skewed" ? "Call-Skewed" : "Flat";
}

// ---------------------------------------------------------------------------
// IV/HV ratio -- deliberately NOT given a good/bad label (raw IV and HV
// are correctly unlabeled: Percentile already answers "is this normal
// for this stock"). Only a data-quality caution when the ratio falls
// outside a normal range -- an outlier here could reflect a real signal
// or a thin/stale IV read, and this tool can't tell which, so the
// wording stays a caution rather than a confident risk/safety claim.
// ---------------------------------------------------------------------------

export const IV_HV_RATIO_LOW_BOUND = 0.6;
export const IV_HV_RATIO_HIGH_BOUND = 2.5;

export const IV_HV_RATIO_CAUTION_TEXT = "Unusual ratio — verify during market hours";

export function ivHvRatioCaution(ratio: number | null): string | null {
  if (ratio == null) return null;
  if (ratio < IV_HV_RATIO_LOW_BOUND || ratio > IV_HV_RATIO_HIGH_BOUND) {
    return IV_HV_RATIO_CAUTION_TEXT;
  }
  return null;
}
