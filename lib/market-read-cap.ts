/**
 * Phase 43 Part C -- a simple, global daily cap on Market-Read-style
 * Anthropic generations (the per-ticker briefing bullets + directional
 * lean), so a burst of stale-cache page loads can't run up an unbounded
 * Anthropic bill in one day. Deliberately scoped to just this one call
 * path -- Today's Summary (a single daily generation already, via its
 * own 6hr TTL) and headline classification (already cheap/batched) are
 * untouched.
 *
 * The counter lives in one row per calendar date (see
 * supabase/migrations/0010_market_read_generation_log.sql) -- "reset at
 * midnight" falls out for free from the row key, no cron/reset job
 * needed. The read-then-upsert increment below isn't perfectly atomic
 * under concurrent requests, but this is a soft cost-control cap, not a
 * security boundary -- an occasional off-by-one during a concurrent
 * burst is a non-issue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const MARKET_READ_DAILY_CAP = (() => {
  const parsed = Number(process.env.MARKET_READ_DAILY_CAP);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
})();

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface DailyGenerationStatus {
  count: number;
  cap: number;
  capHit: boolean;
}

export async function getDailyGenerationStatus(
  supabase: SupabaseClient<Database>
): Promise<DailyGenerationStatus> {
  const { data, error } = await supabase
    .from("market_read_generation_log")
    .select("count")
    .eq("date", todayIsoDate())
    .maybeSingle();

  if (error) {
    console.error("Failed to read today's Market Read generation count:", error.message);
  }

  const count = data?.count ?? 0;
  return { count, cap: MARKET_READ_DAILY_CAP, capHit: count >= MARKET_READ_DAILY_CAP };
}

/** Called only after a real generation actually succeeds -- a capped or failed attempt never increments this. */
export async function incrementDailyGenerationCount(supabase: SupabaseClient<Database>): Promise<void> {
  const date = todayIsoDate();
  const { data, error: readError } = await supabase
    .from("market_read_generation_log")
    .select("count")
    .eq("date", date)
    .maybeSingle();

  if (readError) {
    console.error("Failed to read today's Market Read generation count before increment:", readError.message);
  }

  const { error: upsertError } = await supabase
    .from("market_read_generation_log")
    .upsert({ date, count: (data?.count ?? 0) + 1 }, { onConflict: "date" });

  if (upsertError) {
    console.error("Failed to increment today's Market Read generation count:", upsertError.message);
  }
}
