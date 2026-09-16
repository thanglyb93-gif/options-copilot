/**
 * Expected-move-based strike cushion, per contract. Pure -- no API/DB
 * calls.
 */

import { interpolateScore, type TradeDirection } from "./entry-score";
import type { StructuralTrend, Suitability } from "./relative-strength";

/** One-standard-deviation expected move to expiration, in price terms. */
export function expectedMove(currentPrice: number, ivDecimal: number, dte: number): number {
  return currentPrice * ivDecimal * Math.sqrt(dte / 365);
}

/**
 * How many expected moves of cushion a strike has before being breached.
 * Negative means the strike is already past the current price on the
 * wrong side (for a put, above price; for a call, below price).
 */
export function strikeCushion(
  currentPrice: number,
  strike: number,
  expectedMoveValue: number,
  direction: TradeDirection
): number {
  if (expectedMoveValue <= 0) return 0;
  return direction === "put"
    ? (currentPrice - strike) / expectedMoveValue
    : (strike - currentPrice) / expectedMoveValue;
}

/**
 * EM-multiple -> score. Checked top-down; first satisfied band wins.
 * Exported so lib/guidance-content.ts can generate its threshold
 * descriptions directly from this, rather than duplicating the numbers.
 */
export const CUSHION_SCORE_BANDS = [
  { min: 2.0, score: 2.0 },
  { min: 1.5, score: 1.5 },
  { min: 1.0, score: 1.0 },
  { min: 0.5, score: 0.5 },
  { min: -Infinity, score: 0 },
] as const;

/**
 * Cushion score, continuously interpolated between CUSHION_SCORE_BANDS'
 * anchors (Phase 40 -- see lib/entry-score.ts's interpolateScore) rather
 * than banded into a discrete bucket, optionally requiring a larger
 * real EM multiple to reach the same score -- see momentumBufferMultiplier
 * below. `momentumMultiplier` defaults to 1.0 (no change) so every
 * existing caller is unaffected unless it explicitly opts in; when it's
 * not 1.0, each anchor's threshold (not its score) is scaled before
 * interpolating, exactly mirroring the old discrete-banding behavior.
 * Stays on its original 0-2 scale here -- lib/entry-score.ts's
 * combineWithStrikeCushion is what scales this to the Entry Score's
 * Technical/EM Cushion weight (2.5) for that specific 0-10 total; this
 * function's other callers (Roll Calculator, Simulated Backtest,
 * Counterfactual Backtest) use the unscaled 0-2 value directly.
 */
export function cushionScore(emMultiple: number, momentumMultiplier = 1.0): number {
  const scaledAnchors = CUSHION_SCORE_BANDS.map((b) => ({
    min: Number.isFinite(b.min) ? b.min * momentumMultiplier : b.min,
    score: b.score,
  }));
  return interpolateScore(emMultiple, scaledAnchors);
}

// ---------------------------------------------------------------------------
// Momentum-adjusted cushion buffer (Phase 34) -- calls only.
//
// Real trade-history analysis found call losses averaging over 10x
// larger than put losses, concentrated in high-momentum names (CRCL,
// OKLO, NBIS) where the stock ran straight through a strike the
// expected-move math called "safe." A short put facing a symmetric
// down-move doesn't show the same pattern in that data, so this is a
// deliberately asymmetric adjustment: puts are never touched, and the
// underlying expected-move math itself (expectedMove, strikeCushion
// above) is never touched either -- only the EM-multiple thresholds a
// CALL is banded against, and only when the specific momentum conditions
// below are met.
// ---------------------------------------------------------------------------

/**
 * How much extra cushion distance a call needs, in EM multiples, when the
 * underlying is both outperforming (lib/relative-strength.ts) and in a
 * healthy uptrend structure. An adjustable heuristic derived from the
 * real trade-loss analysis above -- not a universal law -- so it's a
 * named constant, not a magic number, and easy to retune as more trade
 * history accumulates.
 */
export const MOMENTUM_BUFFER_MULTIPLIER = 1.3;

/**
 * Returns the EM-multiple threshold multiplier cushionScore should apply
 * for this direction -- 1.0 (no change) for every put, and for a call
 * unless the underlying is BOTH classified "outperforming" (beats market
 * and, when defined, sector, by a meaningful margin) AND has a healthy
 * "higher-highs-higher-lows" structural trend. Both are already computed
 * by lib/relative-strength.ts's evaluateRelativeStrength() -- this never
 * re-derives them or fetches anything itself.
 */
export function momentumBufferMultiplier(
  direction: TradeDirection,
  relativeStrengthResult: { suitability: Suitability } | null,
  structuralTrend: StructuralTrend | null
): number {
  if (direction !== "call") return 1.0;
  if (relativeStrengthResult?.suitability === "outperforming" && structuralTrend === "higher-highs-higher-lows") {
    return MOMENTUM_BUFFER_MULTIPLIER;
  }
  return 1.0;
}
