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
