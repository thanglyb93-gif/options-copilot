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
