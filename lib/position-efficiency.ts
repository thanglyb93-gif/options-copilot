/**
 * Phase 36 -- Position Efficiency: how much premium income a covered-call
 * holding has actually generated per dollar of capital committed,
 * annualized, compared against the portfolio's own average. A plain
 * comparison surfaced alongside the existing Hold/Close, Assignment
 * Opportunity Cost, and Roll Calculator reads -- never folded into the
 * Entry Score, never a directive to sell.
 *
 * KNOWN LIMITATION (state this plainly wherever the result is shown, not
 * silently around it): this can only see premium collected on positions
 * actually logged in this app -- the `positions` table's open, closed,
 * assigned, and expired rows all persist by design (see
 * supabase/migrations/0001_init.sql's status enum), but there is no
 * record of any covered-call history for a ticker from BEFORE it was
 * first logged here. A long-held stock only recently added to this app
 * will show a short, possibly misleading daysTracked/yield even if
 * calls have actually been sold against it for years -- that's a real
 * gap, not something this module works around. A future CSV-import
 * phase could backfill real history; until then, every number here is
 * computed honestly off whatever's actually logged, even when that's
 * currently sparse.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PositionRow } from "@/types/database";

/** A ticker's annualized yield below this fraction of the portfolio average counts as "meaningfully underperforming." Adjustable. */
export const EFFICIENCY_UNDERPERFORM_RATIO = 0.5;

/** Fewer distinct tickers with computable covered-call yield than this, and the portfolio average isn't treated as meaningful -- same small-n discipline as every other signal in this app (e.g. Phase 33's stabilization-pattern sample-size gate). */
export const MIN_TICKERS_FOR_PORTFOLIO_AVERAGE = 3;

export interface TickerEfficiency {
  ticker: string;
  /** Total $ premium collected across every logged covered-call row for this ticker, any status. */
  totalPremiumCollected: number;
  /** costBasis * shares from the most recently opened row -- null when either is unrecorded. Every covered-call row logged against the same held shares should carry the same cost basis/share count; the most recent row is the most likely to reflect it accurately. */
  capitalCommitted: number | null;
  /** today - earliest opened_at among this ticker's logged covered-call rows. A proxy for "how long we've been tracking this holding IN THIS APP," not necessarily the true share-acquisition date -- that isn't separately captured by the schema. */
  daysTracked: number;
  /** totalPremiumCollected / capitalCommitted * (365 / daysTracked) * 100. Null when capitalCommitted is null/zero. */
  annualizedYieldPct: number | null;
  rowCount: number;
}

export interface PortfolioAverageYield {
  /** Mean of annualizedYieldPct across every ticker with a computable yield. Null when none exists. */
  averageYieldPct: number | null;
  /** Distinct tickers actually contributing to the average -- the sample size the "meaningful comparison" gate is judged on. */
  tickerCount: number;
  perTicker: TickerEfficiency[];
}

export interface EfficiencyResult {
  ticker: string;
  tickerYieldPct: number | null;
  portfolioAverageYieldPct: number | null;
  portfolioTickerCount: number;
  /** True when portfolioTickerCount < MIN_TICKERS_FOR_PORTFOLIO_AVERAGE -- the comparison is still shown, explicitly caveated as not yet meaningful, never silently hidden. */
  sampleSizeInsufficient: boolean;
  flagged: boolean;
  daysTracked: number;
  totalPremiumCollected: number;
  capitalCommitted: number | null;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + "T00:00:00Z").getTime();
  const to = new Date(toIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/** Aggregates one ticker's already-fetched covered-call rows (any status) into a single efficiency read. */
function aggregateTickerEfficiency(ticker: string, rows: PositionRow[]): TickerEfficiency {
  const totalPremiumCollected = rows.reduce((sum, r) => sum + r.premium_collected * 100 * r.contracts, 0);

  const earliestOpenedAt = rows.reduce((earliest, r) => (r.opened_at < earliest ? r.opened_at : earliest), rows[0].opened_at);
  const daysTracked = Math.max(1, daysBetween(earliestOpenedAt, new Date().toISOString()));

  const mostRecent = [...rows].sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))[0];
  const capitalCommitted =
    mostRecent.cost_basis != null && mostRecent.shares_owned != null
      ? mostRecent.cost_basis * mostRecent.shares_owned
      : null;

  const annualizedYieldPct =
    capitalCommitted != null && capitalCommitted > 0
      ? (totalPremiumCollected / capitalCommitted) * (365 / daysTracked) * 100
      : null;

  return { ticker, totalPremiumCollected, capitalCommitted, daysTracked, annualizedYieldPct, rowCount: rows.length };
}

/**
 * Queries every logged covered-call row (any status) for `ticker` and
 * aggregates them into one efficiency read. Null only when nothing is
 * logged for this ticker at all.
 */
export async function computeEfficiency(
  supabase: SupabaseClient<Database>,
  ticker: string
): Promise<TickerEfficiency | null> {
  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .eq("ticker", ticker)
    .eq("position_type", "covered_call");

  if (error) {
    console.error(`Failed to read positions for efficiency (${ticker}):`, error.message);
    return null;
  }
  const rows = (data ?? []) as PositionRow[];
  if (rows.length === 0) return null;

  return aggregateTickerEfficiency(ticker, rows);
}

/**
 * Queries every logged covered-call row (any status, every ticker) and
 * aggregates a per-ticker efficiency for each, plus their mean. The one
 * query the /positions route needs to build every open covered-call
 * position's comparison -- avoids a second per-ticker query, since
 * `perTicker` already has every ticker's figure.
 */
export async function computePortfolioAverageYield(
  supabase: SupabaseClient<Database>
): Promise<PortfolioAverageYield> {
  const { data, error } = await supabase.from("positions").select("*").eq("position_type", "covered_call");

  if (error) {
    console.error("Failed to read positions for portfolio average yield:", error.message);
    return { averageYieldPct: null, tickerCount: 0, perTicker: [] };
  }

  const rows = (data ?? []) as PositionRow[];
  const byTicker = new Map<string, PositionRow[]>();
  for (const r of rows) {
    const list = byTicker.get(r.ticker) ?? [];
    list.push(r);
    byTicker.set(r.ticker, list);
  }

  const perTicker = Array.from(byTicker.entries()).map(([ticker, tickerRows]) =>
    aggregateTickerEfficiency(ticker, tickerRows)
  );

  const withYield = perTicker.filter((e): e is TickerEfficiency & { annualizedYieldPct: number } => e.annualizedYieldPct != null);
  const averageYieldPct =
    withYield.length > 0 ? withYield.reduce((sum, e) => sum + e.annualizedYieldPct, 0) / withYield.length : null;

  return { averageYieldPct, tickerCount: withYield.length, perTicker };
}

/**
 * Combines one ticker's efficiency with the portfolio average into the
 * flag the UI shows. Never fabricates a comparison from too small a
 * sample -- flagged is always false when sampleSizeInsufficient, even if
 * the raw numbers would otherwise clear the threshold.
 */
export function evaluateEfficiencyFlag(
  tickerEfficiency: TickerEfficiency | null,
  portfolioAverage: PortfolioAverageYield
): EfficiencyResult | null {
  if (!tickerEfficiency) return null;

  const sampleSizeInsufficient = portfolioAverage.tickerCount < MIN_TICKERS_FOR_PORTFOLIO_AVERAGE;
  const flagged =
    !sampleSizeInsufficient &&
    tickerEfficiency.annualizedYieldPct != null &&
    portfolioAverage.averageYieldPct != null &&
    portfolioAverage.averageYieldPct > 0 &&
    tickerEfficiency.annualizedYieldPct < portfolioAverage.averageYieldPct * EFFICIENCY_UNDERPERFORM_RATIO;

  return {
    ticker: tickerEfficiency.ticker,
    tickerYieldPct: tickerEfficiency.annualizedYieldPct,
    portfolioAverageYieldPct: portfolioAverage.averageYieldPct,
    portfolioTickerCount: portfolioAverage.tickerCount,
    sampleSizeInsufficient,
    flagged,
    daysTracked: tickerEfficiency.daysTracked,
    totalPremiumCollected: tickerEfficiency.totalPremiumCollected,
    capitalCommitted: tickerEfficiency.capitalCommitted,
  };
}
