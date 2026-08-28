import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { fetchHistoricalCloses, type DailyClose } from "@/lib/yahoo";
import type { LeanHistoryRow, LeanOutcome } from "@/types/database";

/**
 * How far a lean's realized price move has to be, in either direction,
 * before it counts as a real confirmation/reversal rather than noise --
 * same order of magnitude as earningsCooldownFlag's move threshold
 * (lib/flags.ts), chosen for a similar "is this move meaningful" judgment.
 */
const LEAN_OUTCOME_THRESHOLD_PCT = 3;

/** Calendar days of history to fetch per ticker -- generous enough to cover any pending row's snapshot date plus 10 trading days. */
const HISTORY_LOOKBACK_DAYS = 400;

interface ResolveResult {
  ticker: string;
  date: string;
  status: "resolved" | "pending" | "error";
  outcome?: LeanOutcome;
  error?: string;
}

function classifyOutcome(
  lean: LeanHistoryRow["lean"],
  priceAtSnapshot: number,
  priceAfter: number
): LeanOutcome {
  if (lean === "neutral" || lean === "mixed") {
    return "unclear";
  }

  if (priceAtSnapshot === 0) {
    return "unclear";
  }

  const percentMove = ((priceAfter - priceAtSnapshot) / priceAtSnapshot) * 100;

  if (lean === "bullish") {
    if (percentMove > LEAN_OUTCOME_THRESHOLD_PCT) return "held_up";
    if (percentMove < -LEAN_OUTCOME_THRESHOLD_PCT) return "reversed";
    return "unclear";
  }

  // lean === "bearish"
  if (percentMove < -LEAN_OUTCOME_THRESHOLD_PCT) return "held_up";
  if (percentMove > LEAN_OUTCOME_THRESHOLD_PCT) return "reversed";
  return "unclear";
}

/**
 * Finds the closes-array index for `date` (exact match, or the first
 * trading day at/after it if the snapshot date itself wasn't a trading
 * day) -- same index-counting convention as earningsCooldownFlag
 * (lib/flags.ts) rather than calendar-date arithmetic, so weekends/
 * holidays are handled correctly.
 */
function findCloseIndex(closes: DailyClose[], date: string): number {
  const exact = closes.findIndex((c) => c.date === date);
  if (exact !== -1) return exact;
  return closes.findIndex((c) => c.date >= date);
}

async function runResolve(): Promise<{ results: ResolveResult[] }> {
  const supabase = getSupabaseRouteClient();

  const { data: pending, error: pendingError } = await supabase
    .from("lean_history")
    .select("*")
    .is("outcome", null);

  if (pendingError) {
    throw new Error(`Failed to read pending lean_history rows: ${pendingError.message}`);
  }

  const results: ResolveResult[] = [];
  const rowsByTicker = new Map<string, LeanHistoryRow[]>();
  for (const row of pending ?? []) {
    const list = rowsByTicker.get(row.ticker) ?? [];
    list.push(row);
    rowsByTicker.set(row.ticker, list);
  }

  for (const [ticker, rows] of Array.from(rowsByTicker)) {
    let closes: DailyClose[];
    try {
      closes = await fetchHistoricalCloses(ticker, HISTORY_LOOKBACK_DAYS);
    } catch (error) {
      for (const row of rows) {
        results.push({
          ticker,
          date: row.date,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
      continue;
    }

    for (const row of rows) {
      const index = findCloseIndex(closes, row.date);
      const targetIndex = index === -1 ? -1 : index + 10;

      if (index === -1 || targetIndex >= closes.length) {
        results.push({ ticker, date: row.date, status: "pending" });
        continue;
      }

      const priceAfter = closes[targetIndex].close;
      const outcome = classifyOutcome(row.lean, row.price_at_snapshot, priceAfter);

      const { error: updateError } = await supabase
        .from("lean_history")
        .update({ price_after_10_trading_days: priceAfter, outcome })
        .eq("id", row.id);

      results.push(
        updateError
          ? { ticker, date: row.date, status: "error", error: updateError.message }
          : { ticker, date: row.date, status: "resolved", outcome }
      );
    }
  }

  return { results };
}

/**
 * Vercel Cron always invokes via GET (see vercel.json); POST is kept for
 * manual/curl triggering, same convention as /api/iv-snapshot.
 */
export async function GET() {
  try {
    return NextResponse.json(await runResolve());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runResolve());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
