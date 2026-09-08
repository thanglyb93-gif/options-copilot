/**
 * Phase 38 -- personalized counterfactual backtest: for a user's own
 * past LOSING covered-call trade (imported via Phase 37), what would
 * Phase 34's momentum-adjusted cushion buffer have suggested at that
 * exact historical entry, and what would that actually have changed?
 *
 * CRITICAL FRAMING: this is a retrospective "what if" replaying this
 * app's own current methodology against real historical prices -- not a
 * claim the alternative strike would definitely have been better in
 * every way. A wider strike also collects less premium up front; both
 * sides of that tradeoff are always returned together
 * (counterfactual.realizedPL AND premiumForgone), never just the
 * avoided loss.
 *
 * Reuses lib/simulated-backtest.ts's exact modeling conventions end to
 * end -- no new targeting rule, no new pricing model: same HV-as-IV
 * stand-in, same Black-Scholes pricing, same EM-cushion strike
 * targeting (BACKTEST_TARGET_CUSHION), just with Phase 34's
 * momentumBufferMultiplier applied to that target cushion, evaluated
 * using conditions AS THEY WERE on the historical entry date (via
 * lib/relative-strength.ts's optional `asOf` parameter, added
 * specifically so this could reuse that module instead of duplicating
 * its window/structural-trend logic). The stock leg is deliberately
 * left out of both sides of the comparison: the same real, already-
 * owned shares are held either way, so it's identical in the actual and
 * counterfactual scenarios and cancels out -- comparing option-leg-only
 * P/L (Phase 37's own convention for a position with no known cost
 * basis) is the correct, apples-to-apples comparison here, not a
 * simplification.
 *
 * Pure -- no API/DB calls; callers gather the raw historical closes
 * (ticker, SPY, sector peers), each covering from well before the
 * position's opened_at through at least its expiration_date.
 */

import type { DailyClose } from "./yahoo";
import { historicalVolatility } from "./volatility";
import { expectedMove } from "./expected-move";
import { momentumBufferMultiplier } from "./expected-move";
import { blackScholesPrice } from "./options-math";
import { describeRelativeStrength, evaluateRelativeStrength, type PeerHistoricals } from "./relative-strength";
import { BACKTEST_TARGET_CUSHION } from "./simulated-backtest";

const HV_MODEL_PERIOD = 30;
const SHARES_PER_CONTRACT = 100;
/** Modeled strikes are rounded to the nearest dollar -- same as Simulated Backtest, no real strike ladder to snap to when replaying history. */
const STRIKE_ROUNDING = 1;

function indexAtOrBefore(closes: DailyClose[], targetDate: string): number {
  let idx = -1;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i].date <= targetDate) idx = i;
    else break;
  }
  return idx;
}

function indexAtOrAfter(closes: DailyClose[], targetDate: string, fromIndex: number): number {
  for (let i = fromIndex; i < closes.length; i++) {
    if (closes[i].date >= targetDate) return i;
  }
  return -1;
}

function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export interface CounterfactualInputPosition {
  positionId: string;
  ticker: string;
  strike: number;
  /** Per share -- the real premium actually collected. */
  premiumCollected: number;
  contracts: number;
  openedAt: string; // "YYYY-MM-DD"
  expirationDate: string; // "YYYY-MM-DD"
  /** The real, already-stored realized P/L for this position (option-leg-only, per Phase 37's import convention). */
  realizedPl: number;
}

export interface CounterfactualLegOutcome {
  strike: number;
  /** The EM-multiple target actually used to pick this strike -- BACKTEST_TARGET_CUSHION * momentumMultiplier. */
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
  /** Modeled IV (trailing 30d realized volatility as of entryDate), decimal. */
  modeledIv: number;
  /** 1.0 if Phase 34's momentum conditions weren't met at this historical entry -- the counterfactual strike is then just this app's ordinary baseline targeting, not a "momentum-adjusted" one; always check this before calling it that. */
  momentumMultiplier: number;
  momentumActive: boolean;
  /** Populated only when momentumActive -- the actual historical outperformance/structure that triggered it, same text Phase 34's live UI would have shown that day. */
  momentumReason: string | null;
  actual: {
    strike: number;
    premiumPerShare: number;
    totalPremium: number;
    realizedPL: number;
  };
  counterfactual: CounterfactualLegOutcome;
  /** counterfactual.realizedPL - actual.realizedPL. Positive means the counterfactual strike would have done better overall; can still be shown alongside a positive premiumForgone. */
  avoidedLoss: number;
  /** actual.totalPremium - counterfactual.totalPremium. Positive (the typical case) means the actual, narrower strike collected more premium up front -- the real cost of the wider strike's extra safety, always reported alongside avoidedLoss. */
  premiumForgone: number;
}

/**
 * `historicals` must cover from at least HV_MODEL_PERIOD + relative-
 * strength's own lookback (~400 calendar days) before `position.openedAt`
 * through at least `position.expirationDate`. `spyHistoricals`/
 * `peerHistoricals` need the same span; this function does its own
 * date-filtering internally via lib/relative-strength.ts's `asOf`
 * parameter, so callers can simply pass the full fetched range. Returns
 * null when there isn't enough historical data to reconstruct the entry
 * or walk to the real expiration close -- never a fabricated result.
 */
export function computeCounterfactual(
  position: CounterfactualInputPosition,
  historicals: DailyClose[],
  spyHistoricals: DailyClose[],
  peerHistoricals: PeerHistoricals[] | null,
  peerGroupName: string | null
): CounterfactualComparison | null {
  const entryIndex = indexAtOrBefore(historicals, position.openedAt);
  if (entryIndex < HV_MODEL_PERIOD) return null;

  const entryClose = historicals[entryIndex];
  const modeledIv = historicalVolatility(historicals.slice(0, entryIndex + 1), HV_MODEL_PERIOD);
  if (modeledIv == null || modeledIv <= 0) return null;

  const expiryIndex = indexAtOrAfter(historicals, position.expirationDate, entryIndex + 1);
  if (expiryIndex === -1) return null;
  const expiryClose = historicals[expiryIndex];
  const dte = daysBetween(entryClose.date, expiryClose.date);
  if (dte <= 0) return null;

  const asOfEntry = new Date(`${entryClose.date}T00:00:00Z`);
  const relativeStrengthAtEntry = evaluateRelativeStrength(
    position.ticker,
    historicals.slice(0, entryIndex + 1),
    spyHistoricals.filter((c) => c.date <= entryClose.date),
    peerHistoricals
      ? peerHistoricals.map((p) => ({ ticker: p.ticker, closes: p.closes.filter((c) => c.date <= entryClose.date) }))
      : null,
    asOfEntry
  );

  const momentumMultiplier = momentumBufferMultiplier(
    "call",
    relativeStrengthAtEntry,
    relativeStrengthAtEntry.structuralTrend
  );
  const momentumActive = momentumMultiplier > 1.0;
  const momentumReason = momentumActive ? describeRelativeStrength(relativeStrengthAtEntry, peerGroupName) : null;

  const em = expectedMove(entryClose.close, modeledIv, dte);
  const emCushionTarget = BACKTEST_TARGET_CUSHION * momentumMultiplier;
  const rawStrike = entryClose.close + emCushionTarget * em;
  const counterfactualStrike = Math.max(STRIKE_ROUNDING, Math.round(rawStrike / STRIKE_ROUNDING) * STRIKE_ROUNDING);

  const counterfactualPremiumPerShare = blackScholesPrice({
    spot: entryClose.close,
    strike: counterfactualStrike,
    dte,
    volatility: modeledIv,
    optionType: "call",
  });

  const finalPrice = expiryClose.close;
  const counterfactualTotalPremium = counterfactualPremiumPerShare * SHARES_PER_CONTRACT * position.contracts;
  const counterfactualAssigned = finalPrice >= counterfactualStrike;

  // Option-leg-only P/L -- see the module doc comment on why the stock
  // leg is deliberately excluded from both sides of this comparison.
  const counterfactualIntrinsicAtExpiry =
    Math.max(finalPrice - counterfactualStrike, 0) * SHARES_PER_CONTRACT * position.contracts;
  const counterfactualRealizedPL = counterfactualTotalPremium - counterfactualIntrinsicAtExpiry;

  const actualTotalPremium = position.premiumCollected * SHARES_PER_CONTRACT * position.contracts;

  return {
    positionId: position.positionId,
    ticker: position.ticker,
    entryDate: entryClose.date,
    expirationDate: expiryClose.date,
    dte,
    entryPrice: entryClose.close,
    modeledIv,
    momentumMultiplier,
    momentumActive,
    momentumReason,
    actual: {
      strike: position.strike,
      premiumPerShare: position.premiumCollected,
      totalPremium: actualTotalPremium,
      realizedPL: position.realizedPl,
    },
    counterfactual: {
      strike: counterfactualStrike,
      emCushionTarget,
      premiumPerShare: counterfactualPremiumPerShare,
      totalPremium: counterfactualTotalPremium,
      finalPrice,
      assigned: counterfactualAssigned,
      realizedPL: counterfactualRealizedPL,
    },
    avoidedLoss: counterfactualRealizedPL - position.realizedPl,
    premiumForgone: actualTotalPremium - counterfactualTotalPremium,
  };
}
