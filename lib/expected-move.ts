/**
 * Expected-move-based strike cushion, per contract. Pure -- no API/DB
 * calls.
 */

import type { TradeDirection } from "./entry-score";

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

/** EM-multiple -> score. Checked top-down; first satisfied band wins. */
const CUSHION_SCORE_BANDS = [
  { min: 2.0, score: 2.0 },
  { min: 1.5, score: 1.5 },
  { min: 1.0, score: 1.0 },
  { min: 0.5, score: 0.5 },
  { min: -Infinity, score: 0 },
] as const;

export function cushionScore(emMultiple: number): number {
  for (const band of CUSHION_SCORE_BANDS) {
    if (emMultiple >= band.min) return band.score;
  }
  return 0;
}
