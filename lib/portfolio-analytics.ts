/**
 * Beta-weighted portfolio delta: expresses the aggregate directional
 * exposure of all open (written) option positions as an equivalent
 * number of SPY shares. Pure -- no API/DB calls; callers gather the
 * per-position current price/IV/DTE/beta and SPY's price.
 */

import { blackScholesDelta, type OptionType } from "./options-math";

/** Below this many open positions, a portfolio-level summary isn't meaningful. */
export const MIN_OPEN_POSITIONS_FOR_PORTFOLIO_SUMMARY = 2;

export interface PortfolioDeltaPositionInput {
  ticker: string;
  positionType: "covered_call" | "cash_secured_put";
  strike: number;
  contracts: number;
  dte: number;
  underlyingPrice: number;
  iv: number;
  beta: number;
}

export interface PortfolioDeltaContribution {
  ticker: string;
  contribution: number;
}

export interface BetaWeightedDeltaResult {
  totalSpyEquivalentShares: number;
  perPosition: PortfolioDeltaContribution[];
}

/**
 * For each position: current delta via Black-Scholes, then
 * positionExposure = delta * contracts * 100 * (underlyingPrice /
 * spyPrice) * beta, summed across all positions.
 *
 * One deliberate adaptation of that formula: every position this app
 * tracks is a WRITTEN (sold) option, never a held one. blackScholesDelta
 * returns the long-option convention (positive for calls, negative for
 * puts) -- the seller's actual contribution to portfolio delta is the
 * negative of that. A short call is short-leaning exposure (delta
 * negative); a short put is long-leaning exposure (delta positive).
 * Using the raw un-negated delta here would put every position's sign
 * backwards relative to what "selling" it actually means for risk.
 */
export function betaWeightedDelta(
  positions: PortfolioDeltaPositionInput[],
  spyPrice: number
): BetaWeightedDeltaResult {
  if (spyPrice <= 0) {
    return {
      totalSpyEquivalentShares: 0,
      perPosition: positions.map((p) => ({ ticker: p.ticker, contribution: 0 })),
    };
  }

  const perPosition = positions.map((p) => {
    const optionType: OptionType = p.positionType === "covered_call" ? "call" : "put";
    const rawDelta = blackScholesDelta({
      spot: p.underlyingPrice,
      strike: p.strike,
      dte: p.dte,
      volatility: p.iv,
      optionType,
    });
    const writtenPositionDelta = -rawDelta;

    const contribution =
      writtenPositionDelta * p.contracts * 100 * (p.underlyingPrice / spyPrice) * p.beta;

    return { ticker: p.ticker, contribution };
  });

  const totalSpyEquivalentShares = perPosition.reduce((sum, p) => sum + p.contribution, 0);

  return { totalSpyEquivalentShares, perPosition };
}
