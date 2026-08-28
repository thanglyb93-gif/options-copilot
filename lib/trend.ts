/**
 * Plain-language trend derivation from price vs. SMAs. No API/DB calls --
 * unit-testable in isolation.
 */

export interface TrendInput {
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
}

export function describeTrend(input: TrendInput): string {
  const { price, sma20, sma50, sma200 } = input;
  const available = [
    sma20 != null && { label: "20", above: price > sma20 },
    sma50 != null && { label: "50", above: price > sma50 },
    sma200 != null && { label: "200", above: price > sma200 },
  ].filter((v): v is { label: string; above: boolean } => Boolean(v));

  if (available.length === 0) return "Not enough history to assess trend.";

  const above = available.filter((a) => a.above).map((a) => a.label);
  const below = available.filter((a) => !a.above).map((a) => a.label);

  if (below.length === 0) {
    return `Above all ${available.length === 3 ? "three" : available.length} SMAs (${above.join("/")}) — uptrend.`;
  }
  if (above.length === 0) {
    return `Below all ${available.length === 3 ? "three" : available.length} SMAs (${below.join("/")}) — downtrend.`;
  }
  return `Below ${below.join("/")}, above ${above.join("/")} — mixed.`;
}

// ---------------------------------------------------------------------------
// RSI -- informational only. Deliberately NOT wired into Entry Score
// (lib/entry-score.ts) as a fourth component; it's context for the user
// to read alongside the trend/skew/term-structure lines, not a scoring
// input.
// ---------------------------------------------------------------------------

export const RSI_PERIOD = 14;
export const RSI_OVERBOUGHT_THRESHOLD = 70;
export const RSI_OVERSOLD_THRESHOLD = 30;

/** How close to a threshold counts as "approaching" it in describeRsi's text. Adjustable. */
const RSI_APPROACHING_MARGIN = 5;

/**
 * Standard Wilder-smoothed RSI from daily closes (close-to-close, no new
 * data source -- the same closes already fetched for SMA calculation).
 * Null until there are at least `period` + 1 closes to derive changes
 * from.
 */
export function calculateRsi(closes: { close: number }[], period = RSI_PERIOD): number | null {
  if (closes.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i].close - closes[i - 1].close);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type RsiClassification = "overbought" | "oversold" | "neutral";

export function classifyRsi(value: number): RsiClassification {
  if (value > RSI_OVERBOUGHT_THRESHOLD) return "overbought";
  if (value < RSI_OVERSOLD_THRESHOLD) return "oversold";
  return "neutral";
}

/** Plain-language sentence for the Volatility section, same role as describeTrend. */
export function describeRsi(value: number): string {
  const classification = classifyRsi(value);
  let qualifier = "";
  if (classification === "neutral") {
    if (value >= RSI_OVERBOUGHT_THRESHOLD - RSI_APPROACHING_MARGIN) qualifier = ", approaching overbought";
    else if (value <= RSI_OVERSOLD_THRESHOLD + RSI_APPROACHING_MARGIN) qualifier = ", approaching oversold";
  }
  return `RSI: ${Math.round(value)} (${classification}${qualifier}).`;
}
