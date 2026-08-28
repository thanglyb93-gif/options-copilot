/**
 * Covered Call vs. Cash-Secured Put comparison math -- the NEW pieces
 * this feature needs (capital required, yield-on-capital, forward
 * worst-case outcome, directional-edge classification). Everything
 * else a comparison card shows (EM Cushion, structural confirmation,
 * skew scoring, assignment probability, probability of touch,
 * spread/liquidity, relative strength) is computed by calling the
 * existing functions in lib/expected-move.ts, lib/structural-levels.ts,
 * lib/volatility.ts + lib/entry-score.ts's scoreSkewComponent,
 * lib/options-math.ts, and lib/relative-strength.ts directly -- not
 * reimplemented here. Pure -- no API/DB calls; the route gathers raw
 * chain/quote/historical data and does the actual orchestration.
 */

import type { TradeDirection } from "./entry-score";
import type { Suitability } from "./relative-strength";
import { annualizedReturn } from "./options-math";

// ---------------------------------------------------------------------------
// Capital required
// ---------------------------------------------------------------------------

/**
 * Capital newly committed by selling this contract. A covered call uses
 * shares already owned -- no new cash -- so this is always 0 regardless
 * of share count; a cash-secured put requires holding the full strike
 * value as collateral. `currentShareCount` is accepted for interface
 * symmetry with the rest of this module's direction-aware functions
 * (and is what callers use upstream to size `contracts` to what's
 * actually coverable) but doesn't change either branch's formula.
 */
export function capitalRequired(
  direction: TradeDirection,
  strike: number,
  contracts: number,
  currentShareCount: number
): number {
  void currentShareCount;
  if (direction === "call") return 0;
  return strike * 100 * contracts;
}

// ---------------------------------------------------------------------------
// Annualized yield on capital
// ---------------------------------------------------------------------------

/**
 * Annualized yield against the capital actually committed. Both dollar
 * arguments are TOTAL dollars (premium * 100 * contracts; capital
 * already scaled the same way -- capitalRequired()'s own output for a
 * put, or costBasis * shares for a call), not per-share figures.
 *
 * A cash-secured put's capital is capitalRequiredAmount itself (always
 * > 0). A covered call's capitalRequiredAmount is always 0 (see
 * capitalRequired above) -- using 0 as the yield denominator would be
 * both undefined and misleading (it would imply infinite yield on
 * capital that was never actually free), when the real capital is the
 * shares' own original cost basis, already committed before this trade.
 * So for a call, totalCostBasisIfCall is used as the capital base
 * instead: express yield against what's really at risk, not against
 * zero. Reuses lib/options-math.ts's annualizedReturn for the actual
 * division rather than reimplementing it.
 */
export function annualizedYieldOnCapital(
  totalPremium: number,
  capitalRequiredAmount: number,
  dte: number,
  totalCostBasisIfCall: number | null
): number | null {
  const capitalBase = capitalRequiredAmount > 0 ? capitalRequiredAmount : totalCostBasisIfCall;
  if (capitalBase == null || capitalBase <= 0 || dte <= 0) return null;
  return annualizedReturn(totalPremium, capitalBase, dte);
}

// ---------------------------------------------------------------------------
// Forward-looking worst-case outcome
// ---------------------------------------------------------------------------

export interface ForwardWorstCaseResult {
  /** Call only -- guaranteed $ realized if called away (stock leg capped at strike + premium collected). Null for a put. */
  worstCaseRealizedGain: number | null;
  /**
   * Call only -- a rough EM-based ESTIMATE of further upside being
   * capped by the strike, not money owed or a guaranteed loss. Half the
   * expected move is a deliberately conservative "plausible" figure,
   * not a probability-weighted one. Null for a put.
   */
  upsideForgoneEstimate: number | null;
  /** Put only -- if assigned, what the new effective cost basis becomes (strike - premium collected). Null for a call. */
  worstCaseEffectiveBasis: number | null;
}

/**
 * The guaranteed/mechanical worst case for whichever side is being
 * evaluated -- framed as "even in the worst case (assignment), here's
 * where you land," not a prediction of what will happen. costBasis and
 * expectedMoveValue are only meaningful (and only used) on the call
 * side; pass null for a put.
 */
export function forwardWorstCase(
  direction: TradeDirection,
  strike: number,
  costBasis: number | null,
  premiumPerShare: number,
  contracts: number,
  expectedMoveValue: number | null
): ForwardWorstCaseResult {
  const shares = contracts * 100;

  if (direction === "call") {
    const basis = costBasis ?? 0;
    return {
      worstCaseRealizedGain: (strike - basis) * shares + premiumPerShare * shares,
      upsideForgoneEstimate: (expectedMoveValue ?? 0) * shares * 0.5,
      worstCaseEffectiveBasis: null,
    };
  }

  return {
    worstCaseRealizedGain: null,
    upsideForgoneEstimate: null,
    worstCaseEffectiveBasis: strike - premiumPerShare,
  };
}

// ---------------------------------------------------------------------------
// Directional edge -- derived from Phase 23's relative-strength
// suitability label, not a new set of thresholds. When the underlying
// gives no clear lean (suitability "inline" -- roughly in line with the
// market/sector, or a structure too mixed to call), the UI states that
// plainly rather than forcing a bullish/bearish framing onto a side-by-
// side comparison.
// ---------------------------------------------------------------------------

export type DirectionalEdge = "bullish" | "bearish" | "unclear";

export function classifyDirectionalEdge(suitability: Suitability): DirectionalEdge {
  if (suitability === "outperforming") return "bullish";
  if (suitability === "underperforming") return "bearish";
  return "unclear";
}
