/**
 * Relative-strength evaluation for the Screener: how a candidate stock's
 * price has actually performed against the broad market and its sector
 * peers, plus a longer-horizon structural read -- built as the direct
 * fix for a real mistake (an OKLO assignment that turned into a loss)
 * where a stock was traded on tactical merits alone without ever
 * checking whether it was fundamentally sound relative to its peers.
 * Pure -- no API/DB calls; callers gather the raw historical closes.
 *
 * Analyst-estimate-revision data (Finnhub's recommendation-trend
 * endpoint) was investigated and confirmed NOT available on this app's
 * free-tier Finnhub key (a live request returns a redirect/404, unlike
 * every other Finnhub endpoint this app uses, which return real data).
 * Per the brief, that piece is skipped entirely here rather than faked
 * -- there is no revisionTrend field.
 */

export interface DailyCloseLike {
  date: string; // "YYYY-MM-DD"
  close: number;
}

// ---------------------------------------------------------------------------
// Lookback windows
// ---------------------------------------------------------------------------

/** Very-short window -- Phase 29: a fast-moving consistency check alongside the existing 90d/180d windows. */
export const VERY_SHORT_LOOKBACK_DAYS = 30;
/** Short window -- consistency check against existing short-term signals. */
export const SHORT_LOOKBACK_DAYS = 90;
/** Primary window -- matches the "6 months" framing; the UI defaults to this one and suitability is judged on it. */
export const PRIMARY_LOOKBACK_DAYS = 180;
/**
 * Structural-trend lookback -- deliberately longer than and independent
 * of the return-comparison windows above, and longer than the existing
 * ~90-day EM Cushion window (lib/expected-move.ts) -- this is a
 * different, longer-horizon signal, not a restatement of either.
 * ~9 months, within the requested 6-12 month band.
 */
export const STRUCTURAL_TREND_LOOKBACK_DAYS = 270;

/** How many calendar days of history callers should fetch to cover every window above plus the swing-point detection's edge margin. */
export const RELATIVE_STRENGTH_FETCH_DAYS = 400;

// ---------------------------------------------------------------------------
// Return comparison
// ---------------------------------------------------------------------------

function totalReturnPct(closes: DailyCloseLike[], lookbackDays: number): number | null {
  if (closes.length < 2) return null;
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const inWindow = closes.filter((c) => c.date >= cutoffDate);
  if (inWindow.length < 2) return null;
  const start = inWindow[0].close;
  const end = inWindow[inWindow.length - 1].close;
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

export interface RelativeStrengthWindow {
  lookbackDays: number;
  tickerReturnPct: number | null;
  spyReturnPct: number | null;
  /** tickerReturnPct - spyReturnPct. Null if either return couldn't be computed. */
  vsMarketPct: number | null;
  /** Average return across the peer basket. Null if no peer group is defined for this ticker, or no peer data was available. */
  sectorReturnPct: number | null;
  /** tickerReturnPct - sectorReturnPct. Null if no sector group (see Part A's fallback contract) or insufficient peer data. */
  vsSectorPct: number | null;
}

export interface PeerHistoricals {
  ticker: string;
  closes: DailyCloseLike[];
}

/**
 * One lookback window's comparison: ticker's total return vs. SPY's
 * return over the same window (vsMarket), and vs. the average return of
 * its peer basket over the same window (vsSector, null when
 * sectorPeerHistoricals is null -- no sector comparison rather than a
 * fabricated one, per lib/sector-groups.ts's fallback contract).
 */
export function computeRelativeStrength(
  ticker: string,
  tickerHistoricals: DailyCloseLike[],
  spyHistoricals: DailyCloseLike[],
  sectorPeerHistoricals: PeerHistoricals[] | null,
  lookbackDays: number
): RelativeStrengthWindow {
  const tickerReturnPct = totalReturnPct(tickerHistoricals, lookbackDays);
  const spyReturnPct = totalReturnPct(spyHistoricals, lookbackDays);
  const vsMarketPct = tickerReturnPct != null && spyReturnPct != null ? tickerReturnPct - spyReturnPct : null;

  let sectorReturnPct: number | null = null;
  if (sectorPeerHistoricals && sectorPeerHistoricals.length > 0) {
    const peerReturns = sectorPeerHistoricals
      .map((p) => totalReturnPct(p.closes, lookbackDays))
      .filter((v): v is number => v != null);
    sectorReturnPct = peerReturns.length > 0 ? peerReturns.reduce((a, b) => a + b, 0) / peerReturns.length : null;
  }
  const vsSectorPct = tickerReturnPct != null && sectorReturnPct != null ? tickerReturnPct - sectorReturnPct : null;

  return { lookbackDays, tickerReturnPct, spyReturnPct, vsMarketPct, sectorReturnPct, vsSectorPct };
}

// ---------------------------------------------------------------------------
// Structural trend -- swing-point detection over the longer lookback
// ---------------------------------------------------------------------------

export type StructuralTrend = "higher-highs-higher-lows" | "lower-highs-lower-lows" | "mixed";

interface SwingPoint {
  price: number;
  type: "high" | "low";
}

/** A point must be the local extreme within +/- this many trading days to count as a swing point. Adjustable. */
export const SWING_POINT_WINDOW_DAYS = 10;
/** Minimum swing highs (and lows) needed on each side before a structural read is trusted -- fewer than this and there isn't enough shape to classify. */
export const MIN_SWING_POINTS = 2;

function findSwingPoints(prices: number[], window: number): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = window; i < prices.length - window; i++) {
    const slice = prices.slice(i - window, i + window + 1);
    if (prices[i] === Math.max(...slice)) points.push({ price: prices[i], type: "high" });
    else if (prices[i] === Math.min(...slice)) points.push({ price: prices[i], type: "low" });
  }
  return points;
}

/** Net direction across consecutive values: +1 per rising step, -1 per falling step, 0 for a flat step. */
function netDirection(values: number[]): number {
  let net = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) net++;
    else if (values[i] < values[i - 1]) net--;
  }
  return net;
}

/**
 * Classifies the closes' swing-high/swing-low pattern over
 * STRUCTURAL_TREND_LOOKBACK_DAYS: "higher-highs-higher-lows" (healthy
 * uptrend structure), "lower-highs-lower-lows" (deteriorating
 * structure), or "mixed". Null when there isn't enough swing-point
 * structure in the window to say anything (e.g. a very short or very
 * choppy history with fewer than MIN_SWING_POINTS highs/lows).
 */
export function classifyStructuralTrend(closes: DailyCloseLike[]): StructuralTrend | null {
  const window = closes.slice(-STRUCTURAL_TREND_LOOKBACK_DAYS);
  const prices = window.map((c) => c.close);
  const swings = findSwingPoints(prices, SWING_POINT_WINDOW_DAYS);

  const highs = swings.filter((s) => s.type === "high").map((s) => s.price);
  const lows = swings.filter((s) => s.type === "low").map((s) => s.price);
  if (highs.length < MIN_SWING_POINTS || lows.length < MIN_SWING_POINTS) return null;

  const highsNet = netDirection(highs);
  const lowsNet = netDirection(lows);

  if (highsNet > 0 && lowsNet > 0) return "higher-highs-higher-lows";
  if (highsNet < 0 && lowsNet < 0) return "lower-highs-lower-lows";
  return "mixed";
}

// ---------------------------------------------------------------------------
// Suitability -- combines the primary (180-day) window with structural trend
// ---------------------------------------------------------------------------

export type Suitability = "outperforming" | "inline" | "underperforming";

/** Minimum out/underperformance (percentage points) vs. market or sector to count as meaningful, rather than noise. Adjustable. */
export const SUITABILITY_OUTPERFORM_THRESHOLD_PCT = 5;
export const SUITABILITY_UNDERPERFORM_THRESHOLD_PCT = -5;

/**
 * "outperforming": beats both market and (when defined) sector by more
 * than the threshold, AND has a healthy structural trend. "underperforming":
 * the mirror case (worse than both by the threshold, deteriorating
 * structure). Everything else -- including any case with no sector group
 * defined, judged on market + structure alone -- is "inline". When a
 * sector group isn't defined, vsSectorPct is null and doesn't block
 * either outcome (matches lib/sector-groups.ts's fallback contract: no
 * sector data shouldn't silently downgrade every ungrouped ticker to
 * "inline").
 */
export function classifySuitability(
  vsMarketPct: number | null,
  vsSectorPct: number | null,
  structuralTrend: StructuralTrend | null
): Suitability {
  if (vsMarketPct == null) return "inline";

  const marketOutperforms = vsMarketPct > SUITABILITY_OUTPERFORM_THRESHOLD_PCT;
  const marketUnderperforms = vsMarketPct < SUITABILITY_UNDERPERFORM_THRESHOLD_PCT;
  const sectorOutperforms = vsSectorPct == null || vsSectorPct > SUITABILITY_OUTPERFORM_THRESHOLD_PCT;
  const sectorUnderperforms = vsSectorPct == null || vsSectorPct < SUITABILITY_UNDERPERFORM_THRESHOLD_PCT;
  const healthyStructure = structuralTrend === "higher-highs-higher-lows";
  const deterioratingStructure = structuralTrend === "lower-highs-lower-lows";

  if (marketOutperforms && sectorOutperforms && healthyStructure) return "outperforming";
  if (marketUnderperforms && sectorUnderperforms && deterioratingStructure) return "underperforming";
  return "inline";
}

// ---------------------------------------------------------------------------
// Full evaluation -- both windows + structural trend + suitability
// ---------------------------------------------------------------------------

export interface RelativeStrengthEvaluation {
  ticker: string;
  window30: RelativeStrengthWindow;
  window90: RelativeStrengthWindow;
  window180: RelativeStrengthWindow;
  structuralTrend: StructuralTrend | null;
  suitability: Suitability;
}

/** Runs every lookback window plus the structural-trend and suitability reads in one call -- the one function the Screener route actually calls. */
export function evaluateRelativeStrength(
  ticker: string,
  tickerHistoricals: DailyCloseLike[],
  spyHistoricals: DailyCloseLike[],
  sectorPeerHistoricals: PeerHistoricals[] | null
): RelativeStrengthEvaluation {
  const window30 = computeRelativeStrength(
    ticker,
    tickerHistoricals,
    spyHistoricals,
    sectorPeerHistoricals,
    VERY_SHORT_LOOKBACK_DAYS
  );
  const window90 = computeRelativeStrength(
    ticker,
    tickerHistoricals,
    spyHistoricals,
    sectorPeerHistoricals,
    SHORT_LOOKBACK_DAYS
  );
  const window180 = computeRelativeStrength(
    ticker,
    tickerHistoricals,
    spyHistoricals,
    sectorPeerHistoricals,
    PRIMARY_LOOKBACK_DAYS
  );
  const structuralTrend = classifyStructuralTrend(tickerHistoricals);
  const suitability = classifySuitability(window180.vsMarketPct, window180.vsSectorPct, structuralTrend);

  return { ticker, window30, window90, window180, structuralTrend, suitability };
}

// ---------------------------------------------------------------------------
// Plain-language summary -- template-generated from the computed values,
// no Anthropic call.
// ---------------------------------------------------------------------------

function describeStructuralTrend(trend: StructuralTrend | null): string {
  if (trend === "higher-highs-higher-lows") return ", with a healthy higher-highs-higher-lows structure";
  if (trend === "lower-highs-lower-lows") return ", with a deteriorating lower-highs-lower-lows structure";
  if (trend === "mixed") return ", with a mixed price structure";
  return "";
}

/** Builds the plain-language summary sentence from an already-computed evaluation. Story second, after the raw numbers -- see the Screener UI. */
export function describeRelativeStrength(evaluation: RelativeStrengthEvaluation, peerGroupName: string | null): string {
  const w = evaluation.window180;

  if (w.vsMarketPct == null) {
    return `Not enough price history for ${evaluation.ticker} to compute relative strength over the primary ${PRIMARY_LOOKBACK_DAYS}-day window.`;
  }

  const marketVerb = w.vsMarketPct >= 0 ? "outperformed" : "underperformed";
  let sentence = `${evaluation.ticker} has ${marketVerb} SPY by ${Math.abs(w.vsMarketPct).toFixed(1)}% over the last 6 months`;

  if (w.vsSectorPct != null && peerGroupName) {
    const sectorVerb = w.vsSectorPct >= 0 ? "outperformed" : "underperformed";
    sentence += ` and has ${sectorVerb} its ${peerGroupName} peers by ${Math.abs(w.vsSectorPct).toFixed(1)}%`;
  }

  sentence += describeStructuralTrend(evaluation.structuralTrend);

  return `${sentence}.`;
}
