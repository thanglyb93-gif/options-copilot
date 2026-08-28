/**
 * Pure math for covered calls and cash-secured puts. No API/DB calls --
 * unit-testable in isolation.
 */

import { assessContractReliability, type ChainContractQuoteLike } from "./flags";

export type OptionType = "call" | "put";

export interface BlackScholesInput {
  spot: number;
  strike: number;
  dte: number; // days to expiration
  volatility: number; // implied volatility, decimal (0.30 = 30%)
  riskFreeRate?: number; // decimal, defaults to 0.04
  dividendYield?: number; // decimal, defaults to 0
  optionType: OptionType;
}

function erf(x: number): number {
  // Abramowitz and Stegun formula 7.1.26, ~1.5e-7 max error.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);

  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function d1d2(input: BlackScholesInput): { d1: number; d2: number; t: number } {
  const { spot, strike, dte, volatility } = input;
  const r = input.riskFreeRate ?? 0.04;
  const q = input.dividendYield ?? 0;
  const t = dte / 365;

  const d1 =
    (Math.log(spot / strike) + (r - q + (volatility * volatility) / 2) * t) /
    (volatility * Math.sqrt(t));
  const d2 = d1 - volatility * Math.sqrt(t);

  return { d1, d2, t };
}

/** Option delta, signed: positive for calls, negative for puts. */
export function blackScholesDelta(input: BlackScholesInput): number {
  if (input.dte <= 0 || input.volatility <= 0) return 0;

  const { d1 } = d1d2(input);
  const q = input.dividendYield ?? 0;
  const t = input.dte / 365;
  const discQ = Math.exp(-q * t);

  return input.optionType === "call"
    ? normCdf(d1) * discQ
    : (normCdf(d1) - 1) * discQ;
}

/** Option theta, per calendar day (negative = value decays over time). */
export function blackScholesTheta(input: BlackScholesInput): number {
  if (input.dte <= 0 || input.volatility <= 0) return 0;

  const { spot, strike, volatility } = input;
  const r = input.riskFreeRate ?? 0.04;
  const q = input.dividendYield ?? 0;
  const { d1, d2, t } = d1d2(input);

  const discQ = Math.exp(-q * t);
  const discR = Math.exp(-r * t);
  const term1 = -(spot * normPdf(d1) * volatility * discQ) / (2 * Math.sqrt(t));

  const thetaPerYear =
    input.optionType === "call"
      ? term1 - r * strike * discR * normCdf(d2) + q * spot * discQ * normCdf(d1)
      : term1 + r * strike * discR * normCdf(-d2) - q * spot * discQ * normCdf(-d1);

  return thetaPerYear / 365;
}

/** Black-Scholes option value (not delta/theta) for a given volatility. */
export function blackScholesPrice(input: BlackScholesInput): number {
  const { spot, strike, optionType } = input;
  if (input.dte <= 0 || input.volatility <= 0) {
    return optionType === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  }

  const r = input.riskFreeRate ?? 0.04;
  const q = input.dividendYield ?? 0;
  const { d1, d2, t } = d1d2(input);
  const discQ = Math.exp(-q * t);
  const discR = Math.exp(-r * t);

  return optionType === "call"
    ? spot * discQ * normCdf(d1) - strike * discR * normCdf(d2)
    : strike * discR * normCdf(-d2) - spot * discQ * normCdf(-d1);
}

export interface ImpliedVolatilityFromPriceInput {
  spot: number;
  strike: number;
  dte: number;
  targetPrice: number;
  optionType: OptionType;
  riskFreeRate?: number;
  dividendYield?: number;
}

/**
 * Solves for the volatility that reproduces `targetPrice` via Black-Scholes
 * (bisection -- BS price is monotonic increasing in volatility). Used as a
 * best-effort IV estimate for contracts whose reported impliedVolatility
 * can't be trusted (e.g. Yahoo returns a near-zero placeholder when a
 * contract has no live bid/ask), using the contract's lastPrice instead.
 * Returns null if targetPrice can't be reconciled with any volatility in a
 * plausible 1%-400% range -- e.g. a stale lastPrice from well before a
 * large move in the underlying, where no estimate would be meaningful.
 */
export function impliedVolatilityFromPrice(
  input: ImpliedVolatilityFromPriceInput
): number | null {
  const { spot, strike, dte, targetPrice, optionType, riskFreeRate, dividendYield } = input;
  if (dte <= 0 || targetPrice <= 0 || spot <= 0) return null;

  const priceAt = (vol: number) =>
    blackScholesPrice({ spot, strike, dte, volatility: vol, optionType, riskFreeRate, dividendYield });

  const minVol = 0.01;
  const maxVol = 4.0;
  if (targetPrice <= priceAt(minVol) || targetPrice >= priceAt(maxVol)) return null;

  let lo = minVol;
  let hi = maxVol;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const price = priceAt(mid);
    if (Math.abs(price - targetPrice) < 0.0005) return mid;
    if (price < targetPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface EffectiveIvAndDeltaInput extends ChainContractQuoteLike {
  strike: number;
}

export interface EffectiveIvAndDelta {
  effectiveIv: number | null;
  ivUnreliable: boolean;
  usingLastPriceFallback: boolean;
  delta: number | null;
}

/**
 * Resolves a contract's effective IV -- solving it from lastPrice
 * (impliedVolatilityFromPrice) when there's no live bid/ask but the
 * market's closed and a real last-traded price exists
 * (assessContractReliability) -- and the delta computed from that IV.
 * This is the exact reliability + IV-solving logic /api/options's
 * mapContract uses to build each display row, extracted here so any
 * other caller needing a contract's real delta (e.g. the Entry Score's
 * Skew component, which needs deltas even when the market's closed and
 * every contract's raw bid/ask is zero) gets the identical,
 * already-battle-tested logic rather than a second copy that can drift.
 */
export function effectiveIvAndDelta(
  contract: EffectiveIvAndDeltaInput,
  optionType: OptionType,
  underlyingPrice: number | undefined,
  dte: number,
  marketState: string | undefined
): EffectiveIvAndDelta {
  const reliability = assessContractReliability(contract, marketState);
  let ivUnreliable = reliability.unreliable;
  let usingLastPriceFallback = reliability.usingLastPriceFallback;
  let effectiveIv = contract.impliedVolatility ?? null;

  if (usingLastPriceFallback && underlyingPrice != null && contract.lastPrice != null) {
    const solvedIv = impliedVolatilityFromPrice({
      spot: underlyingPrice,
      strike: contract.strike,
      dte,
      targetPrice: contract.lastPrice,
      optionType,
    });
    if (solvedIv != null) {
      effectiveIv = solvedIv;
    } else {
      // lastPrice can't be reconciled with any plausible volatility (e.g.
      // stale from before a large move) -- no estimate would be honest.
      ivUnreliable = true;
      usingLastPriceFallback = false;
    }
  }

  const canComputeGreeks = !ivUnreliable && underlyingPrice != null && effectiveIv != null;
  const delta = canComputeGreeks
    ? blackScholesDelta({ spot: underlyingPrice!, strike: contract.strike, dte, volatility: effectiveIv!, optionType })
    : null;

  return { effectiveIv, ivUnreliable, usingLastPriceFallback, delta };
}

/** Downside breakeven price for a covered call, per share. */
export function coveredCallBreakeven(costBasis: number, premiumPerShare: number): number {
  return costBasis - premiumPerShare;
}

/** Breakeven price for a cash-secured put, per share. */
export function cashSecuredPutBreakeven(strike: number, premiumPerShare: number): number {
  return strike - premiumPerShare;
}

/**
 * Covered call P/L at expiration for underlying price S.
 * P/L(S) = (min(S, strike) - costBasis) * shares + totalPremium
 */
export function coveredCallPL(
  underlyingPriceAtExpiration: number,
  strike: number,
  costBasis: number,
  shares: number,
  totalPremium: number
): number {
  return (
    (Math.min(underlyingPriceAtExpiration, strike) - costBasis) * shares +
    totalPremium
  );
}

/**
 * Cash-secured put P/L at expiration for underlying price S.
 * P/L(S) = totalPremium - max(strike - S, 0) * shares
 */
export function cashSecuredPutPL(
  underlyingPriceAtExpiration: number,
  strike: number,
  totalPremium: number,
  shares: number
): number {
  return (
    totalPremium - Math.max(strike - underlyingPriceAtExpiration, 0) * shares
  );
}

/** Annualized return = (premium / capitalAtRisk) * (365 / DTE). */
export function annualizedReturn(
  premium: number,
  capitalAtRisk: number,
  dte: number
): number {
  if (capitalAtRisk <= 0 || dte <= 0) return 0;
  return (premium / capitalAtRisk) * (365 / dte);
}

/**
 * Index of the expiration whose DTE is closest to `target` (default 37,
 * the midpoint of the 30-45 DTE band this app screens for). Used to pick
 * a sensible default expiration instead of always the nearest calendar
 * date, which for weeklies is often a near-expiry contract with no real
 * market.
 */
export function findClosestDteIndex(dtes: number[], target = 37): number {
  let bestIndex = 0;
  let bestDiff = Infinity;
  dtes.forEach((dte, i) => {
    const diff = Math.abs(dte - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  });
  return bestIndex;
}

/**
 * Formats delta as a rough assignment-probability label. Delta already
 * approximates probability of expiring ITM -- this is display formatting
 * only, not a new calculation.
 */
export function assignmentProbabilityLabel(delta: number): string {
  return `~${Math.round(Math.abs(delta) * 100)}%`;
}

/**
 * Approximate probability the underlying touches this strike at any
 * point before expiration (not just at expiry) -- the standard trader's
 * rule of thumb of roughly double the option's delta. This is an
 * approximation, not exact math (a true probability-of-touch is a
 * barrier-option calculation); explicitly capped at 100% since the raw
 * 2x formula can exceed it for high-delta contracts.
 */
export function probabilityOfTouch(delta: number): number {
  return Math.min(2 * Math.abs(delta), 1);
}

export interface ReferencePremiumInput {
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  usingLastPriceFallback: boolean;
}

/**
 * The premium to actually use for math (yield, breakeven, comparisons)
 * from a contract's raw quote fields. A contract with bid=0/ask=0
 * (non-null, just zero) is NOT a valid $0.00 quote -- it means there's
 * no live two-sided market right now. Returning (0+0)/2 for that case
 * would silently show a real-looking "$0.00" premium with no indication
 * anything's wrong, so this returns null instead -- callers decide how
 * to surface "no reliable premium." Mirrors the hasLiveMarket check in
 * lib/flags.ts's assessContractReliability.
 */
export function referencePremium(input: ReferencePremiumInput): number | null {
  if (input.usingLastPriceFallback && input.lastPrice != null) return input.lastPrice;
  const hasLiveMarket = (input.bid ?? 0) > 0 && (input.ask ?? 0) > 0;
  if (hasLiveMarket && input.bid != null && input.ask != null) return (input.bid + input.ask) / 2;
  return null;
}

export type SpreadLabel = "tight" | "moderate" | "wide";

export interface SpreadQualityResult {
  spreadPct: number;
  label: SpreadLabel;
}

/**
 * Bid-ask spread band cutoffs, as a % of mid price. Adjustable defaults,
 * not fixed rules -- tune to taste.
 */
export const SPREAD_TIGHT_MAX_PCT = 5;
export const SPREAD_MODERATE_MAX_PCT = 15;

/**
 * Bid-ask spread as a % of mid price, banded into a quick-read liquidity
 * label. Returns null for anything that isn't a genuinely live,
 * two-sided market (bid/ask missing, zero, or crossed) -- there's no
 * meaningful spread to compute from a single lastPrice fallback quote
 * (Phase 7's market-closed path), so this never fabricates one. Callers
 * can call this unconditionally rather than needing to gate first.
 */
export function spreadQuality(bid: number, ask: number): SpreadQualityResult | null {
  if (bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;

  const spreadPct = ((ask - bid) / mid) * 100;
  const label: SpreadLabel =
    spreadPct < SPREAD_TIGHT_MAX_PCT
      ? "tight"
      : spreadPct <= SPREAD_MODERATE_MAX_PCT
        ? "moderate"
        : "wide";

  return { spreadPct, label };
}
