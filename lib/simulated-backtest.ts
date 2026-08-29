/**
 * SIMULATED backtest of this app's own entry criteria against real
 * historical prices. This is a model-based reconstruction, not a record
 * of real historical option prices -- no free source provides those.
 * Every entry point uses:
 *   - the REAL historical closing price on that date
 *   - a MODELED implied volatility (trailing 30-day realized volatility,
 *     the same HV estimation lib/entry-score.ts's scoreIvComponent
 *     already uses as its own IV stand-in)
 *   - a strike chosen via the SAME EM-cushion targeting used throughout
 *     this app (lib/expected-move.ts), at the SAME 30-45 DTE target this
 *     app screens for (lib/flags.ts's DTE_BAND, ~37 DTE midpoint)
 *   - a modeled premium via the SAME Black-Scholes pricing used
 *     everywhere else (lib/options-math.ts)
 * and then walks forward to REAL subsequent closes to determine the
 * outcome via the SAME P/L formulas already used for real positions.
 * No new targeting rules, no new pricing model -- this reuses the app's
 * existing logic end to end and simply replays it against history.
 * Pure -- no API/DB calls; callers gather the raw historical closes.
 */

import type { DailyClose } from "./yahoo";
import type { TradeDirection } from "./entry-score";
import { historicalVolatility } from "./volatility";
import { expectedMove, CUSHION_SCORE_BANDS } from "./expected-move";
import { blackScholesPrice, cashSecuredPutPL, coveredCallPL } from "./options-math";
import { DTE_BAND_MIN, DTE_BAND_MAX } from "./flags";

// ---------------------------------------------------------------------------
// Adjustable defaults
// ---------------------------------------------------------------------------

/** Target DTE for every modeled entry -- the midpoint of this app's own 30-45 DTE band (lib/flags.ts), same default lib/options-math.ts's findClosestDteIndex uses for real chains. */
export const BACKTEST_TARGET_DTE = Math.round((DTE_BAND_MIN + DTE_BAND_MAX) / 2);

/**
 * Target EM-cushion multiple for the modeled strike -- reuses
 * CUSHION_SCORE_BANDS' own 1.5x threshold (lib/expected-move.ts), the
 * band this app's Entry Score treats as strongly cushioned (1.5/2.0
 * pts), rather than inventing a new number for this feature.
 */
export const BACKTEST_TARGET_CUSHION = CUSHION_SCORE_BANDS[1].min; // 1.5

/** Trailing window for the modeled IV -- matches lib/volatility.ts's historicalVolatility default period. */
const HV_MODEL_PERIOD = 30;

/** Spacing between simulated entry points. */
const ENTRY_SPACING_DAYS = 30;

const SHARES_PER_CONTRACT = 100;

/** Modeled strikes are rounded to the nearest dollar -- there's no real strike ladder to snap to in a simulation. */
const STRIKE_ROUNDING = 1;

// ---------------------------------------------------------------------------
// Date helpers (YYYY-MM-DD strings)
// ---------------------------------------------------------------------------

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** Last index with date <= targetDate, or -1 if none. */
function indexAtOrBefore(closes: DailyClose[], targetDate: string): number {
  let idx = -1;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i].date <= targetDate) idx = i;
    else break;
  }
  return idx;
}

/** First index (from `fromIndex`) with date >= targetDate, or -1 if none. */
function indexAtOrAfter(closes: DailyClose[], targetDate: string, fromIndex: number): number {
  for (let i = fromIndex; i < closes.length; i++) {
    if (closes[i].date >= targetDate) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimulatedEntry {
  entryDate: string;
  entryPrice: number;
  /** Modeled IV, decimal (0.35 = 35%) -- trailing 30d realized volatility as of entryDate. */
  modeledIv: number;
  strike: number;
  expirationDate: string;
  dte: number;
  premiumPerShare: number;
  totalPremium: number;
  finalPrice: number;
  /** True if the strike finished ITM against the seller (put: price < strike; call: price >= strike). */
  assigned: boolean;
  capitalAtRisk: number;
  realizedPL: number;
  returnPct: number;
}

export interface SimulatedBacktestResult {
  ticker: string;
  direction: TradeDirection;
  lookbackMonths: number;
  targetDte: number;
  targetCushion: number;
  /** Oldest first. */
  entries: SimulatedEntry[];
  /** % of entries that finished OTM (kept full premium). Null if no entries could be simulated. */
  winRate: number | null;
  avgReturnPct: number | null;
  bestEntry: SimulatedEntry | null;
  worstEntry: SimulatedEntry | null;
}

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

/**
 * historicals must be sorted oldest-first and cover the full lookback
 * window plus BACKTEST_TARGET_DTE days of forward data past the most
 * recent entry point, plus HV_MODEL_PERIOD days of trailing data before
 * the earliest entry point -- callers gather the raw data (same
 * convention as every other pure lib function in this app).
 */
export function runSimulatedBacktest(
  ticker: string,
  historicals: DailyClose[],
  direction: TradeDirection,
  lookbackMonths = 6
): SimulatedBacktestResult {
  const empty: SimulatedBacktestResult = {
    ticker,
    direction,
    lookbackMonths,
    targetDte: BACKTEST_TARGET_DTE,
    targetCushion: BACKTEST_TARGET_CUSHION,
    entries: [],
    winRate: null,
    avgReturnPct: null,
    bestEntry: null,
    worstEntry: null,
  };

  if (historicals.length === 0) return empty;

  const lastDate = historicals[historicals.length - 1].date;

  // Latest possible entry date: the most recent close that still has
  // ~BACKTEST_TARGET_DTE calendar days of real forward data to walk to.
  let latestEntryIndex = -1;
  for (let i = historicals.length - 1; i >= 0; i--) {
    if (addDays(historicals[i].date, BACKTEST_TARGET_DTE) <= lastDate) {
      latestEntryIndex = i;
      break;
    }
  }
  if (latestEntryIndex === -1) return empty;

  const latestEntryDate = historicals[latestEntryIndex].date;
  const entries: SimulatedEntry[] = [];

  for (let m = 0; m < lookbackMonths; m++) {
    const targetEntryDate = addDays(latestEntryDate, -m * ENTRY_SPACING_DAYS);
    const entryIndex = indexAtOrBefore(historicals, targetEntryDate);
    if (entryIndex < HV_MODEL_PERIOD) continue; // not enough trailing history to model IV

    const entryClose = historicals[entryIndex];
    const modeledIv = historicalVolatility(historicals.slice(0, entryIndex + 1), HV_MODEL_PERIOD);
    if (modeledIv == null || modeledIv <= 0) continue;

    const targetExpiryDate = addDays(entryClose.date, BACKTEST_TARGET_DTE);
    const expiryIndex = indexAtOrAfter(historicals, targetExpiryDate, entryIndex + 1);
    if (expiryIndex === -1) continue;

    const expiryClose = historicals[expiryIndex];
    const dte = daysBetween(entryClose.date, expiryClose.date);
    if (dte <= 0) continue;

    const em = expectedMove(entryClose.close, modeledIv, dte);
    const rawStrike =
      direction === "put"
        ? entryClose.close - BACKTEST_TARGET_CUSHION * em
        : entryClose.close + BACKTEST_TARGET_CUSHION * em;
    const strike = Math.max(STRIKE_ROUNDING, Math.round(rawStrike / STRIKE_ROUNDING) * STRIKE_ROUNDING);

    const premiumPerShare = blackScholesPrice({
      spot: entryClose.close,
      strike,
      dte,
      volatility: modeledIv,
      optionType: direction,
    });
    if (premiumPerShare <= 0) continue;

    const totalPremium = premiumPerShare * SHARES_PER_CONTRACT;
    const finalPrice = expiryClose.close;

    let realizedPL: number;
    let assigned: boolean;
    let capitalAtRisk: number;

    if (direction === "put") {
      assigned = finalPrice < strike;
      realizedPL = cashSecuredPutPL(finalPrice, strike, totalPremium, SHARES_PER_CONTRACT);
      capitalAtRisk = strike * SHARES_PER_CONTRACT;
    } else {
      // Buy-write convention: the simulation assumes shares are acquired
      // at entryClose.close for this entry, same as a real buy-write
      // strategy -- coveredCallPL's blended stock+option P/L is the
      // correct math here (unlike elsewhere in this app, there's no
      // pre-existing share position to avoid conflating with).
      assigned = finalPrice >= strike;
      realizedPL = coveredCallPL(finalPrice, strike, entryClose.close, SHARES_PER_CONTRACT, totalPremium);
      capitalAtRisk = entryClose.close * SHARES_PER_CONTRACT;
    }

    entries.push({
      entryDate: entryClose.date,
      entryPrice: entryClose.close,
      modeledIv,
      strike,
      expirationDate: expiryClose.date,
      dte,
      premiumPerShare,
      totalPremium,
      finalPrice,
      assigned,
      capitalAtRisk,
      realizedPL,
      returnPct: capitalAtRisk > 0 ? (realizedPL / capitalAtRisk) * 100 : 0,
    });
  }

  if (entries.length === 0) return empty;

  entries.reverse(); // oldest first, for display

  const winCount = entries.filter((e) => !e.assigned).length;
  const winRate = (winCount / entries.length) * 100;
  const avgReturnPct = entries.reduce((sum, e) => sum + e.returnPct, 0) / entries.length;
  const bestEntry = entries.reduce((best, e) => (e.returnPct > best.returnPct ? e : best), entries[0]);
  const worstEntry = entries.reduce((worst, e) => (e.returnPct < worst.returnPct ? e : worst), entries[0]);

  return {
    ticker,
    direction,
    lookbackMonths,
    targetDte: BACKTEST_TARGET_DTE,
    targetCushion: BACKTEST_TARGET_CUSHION,
    entries,
    winRate,
    avgReturnPct,
    bestEntry,
    worstEntry,
  };
}
