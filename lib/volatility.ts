/**
 * IV/HV helpers for the daily iv_history snapshot. No API/DB calls --
 * unit-testable in isolation.
 */

export interface AtmContract {
  strike: number;
  impliedVolatility?: number;
}

export interface AtmIvInput {
  underlyingPrice: number;
  calls: AtmContract[];
  puts: AtmContract[];
}

function closestToPrice(
  contracts: AtmContract[],
  price: number
): AtmContract | null {
  let best: AtmContract | null = null;
  let bestDiff = Infinity;

  for (const contract of contracts) {
    const diff = Math.abs(contract.strike - price);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = contract;
    }
  }

  return best;
}

/** Average IV of the closest-to-the-money call and put. */
export function atmImpliedVolatility(input: AtmIvInput): number | null {
  const closestCall = closestToPrice(input.calls, input.underlyingPrice);
  const closestPut = closestToPrice(input.puts, input.underlyingPrice);

  const ivs = [closestCall?.impliedVolatility, closestPut?.impliedVolatility].filter(
    (v): v is number => typeof v === "number" && v > 0
  );

  if (ivs.length === 0) return null;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

export interface CloseLike {
  close: number;
}

/** Annualized historical volatility from daily closes (close-to-close, log returns). */
export function historicalVolatility(
  closes: CloseLike[],
  period = 30
): number | null {
  if (closes.length < period + 1) return null;

  const window = closes.slice(-(period + 1));
  const logReturns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    logReturns.push(Math.log(window[i].close / window[i - 1].close));
  }

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (logReturns.length - 1);

  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Percentile rank (0-100) of `value` within `historical` -- the % of
 * historical readings at or below the current value. Used for IV Rank
 * once enough iv_history exists for a ticker.
 */
export function percentileRank(value: number, historical: number[]): number | null {
  if (historical.length === 0) return null;
  const atOrBelow = historical.filter((v) => v <= value).length;
  return (atOrBelow / historical.length) * 100;
}

/**
 * A trailing-`window`-day HV computed at each of the last `maxSamples`
 * days, building a distribution purely from already-fetched daily
 * closes -- no dependency on iv_history. Used as an approximate stand-in
 * for a real IV percentile while iv_history is still thin (see
 * lib/entry-score.ts's scoreIvComponent), since real daily price history
 * is always available regardless of how long the app has been deployed.
 */
export function rollingHistoricalVolatility(
  closes: CloseLike[],
  window = 30,
  maxSamples = 252
): number[] {
  const series: number[] = [];
  for (let end = closes.length; end > window && series.length < maxSamples; end--) {
    const hv = historicalVolatility(closes.slice(0, end), window);
    if (hv != null) series.push(hv);
  }
  return series;
}

export interface HvPercentileResult {
  percentile: number | null;
  currentHv: number | null;
  sampleCount: number;
}

/**
 * Percentile rank of the stock's current 30-day HV against its own
 * trailing ~1-year distribution of 30-day HV values, built purely from
 * already-fetched daily closes. Unlike IV Percentile (which needs 20+
 * real iv_history rows accumulated one calendar day at a time), this is
 * available immediately -- a real, independent metric in its own right,
 * not just a stand-in for IV. Reuses rollingHistoricalVolatility for the
 * distribution.
 */
export function hvPercentileRank(closes: CloseLike[], window = 30): HvPercentileResult {
  const currentHv = historicalVolatility(closes, window);
  const series = rollingHistoricalVolatility(closes, window);
  const percentile = currentHv != null ? percentileRank(currentHv, series) : null;
  return { percentile, currentHv, sampleCount: series.length };
}

export type IvTermStructureClassification = "backwardation" | "contango" | "flat";

export interface IvTermStructureResult {
  classification: IvTermStructureClassification;
  /** (near - far) / far * 100 -- positive means near-term IV is richer. */
  relativeDifferencePct: number;
}

/**
 * Relative-difference cutoff (%) for calling near vs. far IV
 * "meaningfully" different rather than flat. Adjustable default.
 */
export const TERM_STRUCTURE_THRESHOLD_PCT = 10;

/**
 * Compares front-month (near-term) ATM IV against a far-month (~60-90
 * DTE) ATM IV to classify the volatility term structure:
 * - "backwardation": near-term IV is meaningfully richer than further
 *   out -- the market is pricing in elevated near-term event risk
 *   (earnings, a pending catalyst).
 * - "contango": far-term IV is meaningfully richer -- the normal shape,
 *   since uncertainty compounds with time when nothing near-term is
 *   flagged as unusual.
 * - "flat": the two are within the threshold of each other.
 * Callers are responsible for only calling this with two real, positive
 * IV readings -- see the API route for the 60-90 DTE availability check
 * that gates whether this gets called at all.
 */
export function ivTermStructure(
  nearExpiryAtmIv: number,
  farExpiryAtmIv: number
): IvTermStructureResult {
  const relativeDifferencePct = ((nearExpiryAtmIv - farExpiryAtmIv) / farExpiryAtmIv) * 100;

  const classification: IvTermStructureClassification =
    relativeDifferencePct > TERM_STRUCTURE_THRESHOLD_PCT
      ? "backwardation"
      : relativeDifferencePct < -TERM_STRUCTURE_THRESHOLD_PCT
        ? "contango"
        : "flat";

  return { classification, relativeDifferencePct };
}

/** Plain-language sentence for the Volatility section, same role as lib/trend.ts's describeTrend. */
export function describeIvTermStructure(result: IvTermStructureResult): string {
  switch (result.classification) {
    case "backwardation":
      return "Term structure: backwardation — near-term IV elevated relative to further expirations, consistent with a priced-in near-term event.";
    case "contango":
      return "Term structure: contango — near-term IV is lower than further-out expirations, the normal shape.";
    case "flat":
      return "Term structure: flat — near-term and further-out IV are roughly in line.";
  }
}

// ---------------------------------------------------------------------------
// Volatility skew
// ---------------------------------------------------------------------------

export interface SkewChainContract {
  delta: number | null;
  impliedVolatility: number | null;
}

/**
 * One expiration's calls/puts -- deltas and IVs already computed
 * upstream (Black-Scholes, lib/options-math.ts), not recomputed here.
 * Scoping the input to a single expiration's contracts (rather than a
 * whole multi-expiration chain plus a separate expiration selector)
 * keeps this pure and matches how every other function in this file
 * takes exactly the data it needs.
 */
export interface VolatilitySkewInput {
  calls: SkewChainContract[];
  puts: SkewChainContract[];
}

export type VolatilitySkewLean = "put-skewed" | "call-skewed" | "flat";

export interface VolatilitySkewResult {
  putIv: number;
  callIv: number;
  /** putIv - callIv, in decimal IV units (0.02 = 2 percentage points). */
  skew: number;
  lean: VolatilitySkewLean;
}

/** Target |delta| for the skew comparison -- the standard "25-delta" convention. */
const SKEW_TARGET_ABS_DELTA = 0.25;

/**
 * How far a contract's |delta| may sit from SKEW_TARGET_ABS_DELTA and
 * still count as "the ~25-delta contract" -- beyond this the chain is
 * too thin/gappy near that delta for a real 25-delta read. Adjustable.
 */
const SKEW_MAX_DELTA_DISTANCE = 0.1;

/**
 * Minimum |putIv - callIv| to call the skew meaningfully directional
 * rather than flat, in decimal IV units (0.02 = 2 percentage points).
 * Adjustable.
 */
export const SKEW_FLAT_THRESHOLD = 0.02;

function closestToAbsDelta(
  contracts: SkewChainContract[],
  targetAbsDelta: number,
  maxDistance: number
): SkewChainContract | null {
  let best: SkewChainContract | null = null;
  let bestDiff = Infinity;

  for (const c of contracts) {
    if (c.delta == null || c.impliedVolatility == null || c.impliedVolatility <= 0) continue;
    const diff = Math.abs(Math.abs(c.delta) - targetAbsDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }

  return best != null && bestDiff <= maxDistance ? best : null;
}

/**
 * Compares the ~25-delta put's IV against the ~25-delta call's IV at one
 * expiration -- the standard volatility-skew read: richer put IV signals
 * hedging/downside-protection demand, richer call IV signals
 * speculative/upside demand. Returns null if a ~25-delta contract isn't
 * available within SKEW_MAX_DELTA_DISTANCE on either side (e.g. a thin
 * chain with wide strike gaps) -- a misleading number is worse than no
 * number.
 */
export function volatilitySkew(chain: VolatilitySkewInput): VolatilitySkewResult | null {
  const put25 = closestToAbsDelta(chain.puts, SKEW_TARGET_ABS_DELTA, SKEW_MAX_DELTA_DISTANCE);
  const call25 = closestToAbsDelta(chain.calls, SKEW_TARGET_ABS_DELTA, SKEW_MAX_DELTA_DISTANCE);
  if (put25 == null || call25 == null) return null;

  const putIv = put25.impliedVolatility!;
  const callIv = call25.impliedVolatility!;
  const skew = putIv - callIv;

  const lean: VolatilitySkewLean =
    skew > SKEW_FLAT_THRESHOLD ? "put-skewed" : skew < -SKEW_FLAT_THRESHOLD ? "call-skewed" : "flat";

  return { putIv, callIv, skew, lean };
}

/** Plain-language sentence for the Volatility section, same role as describeIvTermStructure. */
export function describeVolatilitySkew(result: VolatilitySkewResult): string {
  const pts = Math.abs(result.skew * 100).toFixed(1);
  switch (result.lean) {
    case "put-skewed":
      return `Skew: put-skewed — downside protection priced richer than upside (${pts} pts), consistent with hedging demand.`;
    case "call-skewed":
      return `Skew: call-skewed — upside calls priced richer than downside puts (${pts} pts), consistent with speculative demand.`;
    case "flat":
      return "Skew: flat — ~25-delta put and call IV are roughly in line.";
  }
}
