import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { fetchAvailableExpirations, daysToExpiration } from "@/lib/yahoo";
import { findClosestDteIndex } from "@/lib/options-math";
import { mapWithConcurrency } from "@/lib/ranking";
import type { RankingExpirationsResponse } from "@/types/api";

export const maxDuration = 30;

/** Bounds concurrent per-ticker chain lookups, same reasoning as /api/ranking. */
const CONCURRENCY = 8;

/**
 * The Ranking page's DTE/Expiration dropdown needs a real, calendar-based
 * list of selectable dates, same as the Strike Selector's own dropdown --
 * but Strike Selector sources its list from ONE ticker's chain, and
 * Ranking has no single ticker to source from. This fetches every
 * watchlisted ticker's available expiration dates and returns their
 * UNION, sorted chronologically, so the dropdown only ever offers a date
 * at least one watchlisted ticker actually lists. /api/ranking's existing
 * findNearestExpiration() still resolves the chosen date to each
 * ticker's own closest real match -- this endpoint only builds the list
 * of choices, it doesn't change how a choice gets resolved per ticker.
 */
export async function GET() {
  const supabase = getSupabaseRouteClient();
  const { data: watchlist, error: watchlistError } = await supabase.from("watchlist").select("ticker");
  if (watchlistError) {
    return NextResponse.json({ error: watchlistError.message }, { status: 502 });
  }

  const tickers = (watchlist ?? []).map((w) => w.ticker);

  const perTicker = await mapWithConcurrency(tickers, CONCURRENCY, async (ticker) => {
    try {
      return await fetchAvailableExpirations(ticker);
    } catch {
      // One ticker's chain being unavailable shouldn't block the whole dropdown.
      return [];
    }
  });

  const dteByDate = new Map<string, number>();
  for (const dates of perTicker) {
    for (const date of dates) {
      const iso = date.toISOString().slice(0, 10);
      if (!dteByDate.has(iso)) dteByDate.set(iso, daysToExpiration(date));
    }
  }

  const expirations = Array.from(dteByDate.entries())
    .map(([expirationDate, dte]) => ({ expirationDate, dte }))
    .sort((a, b) => a.dte - b.dte);

  const defaultIndex = expirations.length > 0 ? findClosestDteIndex(expirations.map((e) => e.dte), 37) : 0;

  const response: RankingExpirationsResponse = { expirations, defaultIndex };
  return NextResponse.json(response);
}
