/**
 * Pure math for covered calls and cash-secured puts. No API/DB calls --
 * unit-testable in isolation.
 */

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
