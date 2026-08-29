/**
 * Cache-or-generate for the insider-activity summary -- same TTL-cache
 * shape as lib/briefing-service.ts's cacheOrGenerate, just against the
 * insider_activity table instead of briefings. Kept separate rather than
 * generalizing the two into one shared helper: the two payload types
 * (BriefingContent vs InsiderActivitySummary) have no real validation
 * logic in common, and forcing them through one generic would trade a
 * small amount of duplication for a worse abstraction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getInsiderActivitySummary, type InsiderActivitySummary } from "./sec-edgar";

/** Insider activity doesn't change intraday -- a long TTL keeps this app a well-behaved, infrequent SEC EDGAR client. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface InsiderActivityCacheResult {
  summary: InsiderActivitySummary | null;
  generatedAt: string;
  cached: boolean;
}

export async function getOrGenerateInsiderActivity(
  supabase: SupabaseClient<Database>,
  ticker: string,
  forceRefresh = false
): Promise<InsiderActivityCacheResult> {
  if (!forceRefresh) {
    const { data: cached, error: cacheReadError } = await supabase
      .from("insider_activity")
      .select("*")
      .eq("ticker", ticker)
      .maybeSingle();

    if (cacheReadError) {
      console.error(`Failed to read insider_activity cache for ${ticker}:`, cacheReadError.message);
    }

    if (cached) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      if (age < CACHE_TTL_MS) {
        return { summary: cached.content, generatedAt: cached.generated_at, cached: true };
      }
    }
  }

  const summary = await getInsiderActivitySummary(ticker);
  const generatedAt = new Date().toISOString();

  // A null summary means SEC has no CIK for this ticker (not a US
  // reporting company) -- not cached in Supabase (content is NOT NULL),
  // but resolveCik's own in-memory ticker-map cache already makes
  // repeat lookups cheap within a warm process.
  if (summary != null) {
    const { error: upsertError } = await supabase
      .from("insider_activity")
      .upsert({ ticker, content: summary, generated_at: generatedAt }, { onConflict: "ticker" });

    if (upsertError) {
      console.error(`Failed to cache insider activity for ${ticker}:`, upsertError.message);
    }
  }

  return { summary, generatedAt, cached: false };
}
