import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { detectTickerGap } from "@/lib/iv-health";

export async function GET() {
  const supabase = getSupabaseRouteClient();

  try {
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist")
      .select("ticker, added_at");

    if (watchlistError) {
      return NextResponse.json({ error: watchlistError.message }, { status: 502 });
    }

    // Floors gap expectations at the earliest date snapshot collection is
    // known to have succeeded for a currently-watchlisted ticker --
    // self-updating from the data itself, so a ticker added before the
    // app's first real cron run isn't blamed for days collection
    // couldn't possibly have covered. Deliberately scoped to the current
    // watchlist rather than all of iv_history: a removed ticker can leave
    // behind much older rows (confirmed in practice -- a stale MSFT row
    // from weeks earlier, MSFT no longer watchlisted, was otherwise
    // pulling this floor artificially early for every other ticker).
    const watchlistTickers = (watchlist ?? []).map((w) => w.ticker);
    const { data: earliestRow } = await supabase
      .from("iv_history")
      .select("ticker, date")
      .in("ticker", watchlistTickers)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();

    const collectionStartDate = earliestRow?.date ?? null;

    const gaps = [];
    for (const { ticker, added_at } of watchlist ?? []) {
      const { data: rows, error: rowsError } = await supabase
        .from("iv_history")
        .select("date, implied_volatility_avg, trailing_30d_hv")
        .eq("ticker", ticker);

      // Best-effort health check -- a read failure for one ticker
      // shouldn't take down the whole check.
      if (rowsError) continue;

      const gap = detectTickerGap(ticker, added_at, rows ?? [], new Date(), collectionStartDate);
      if (gap) gaps.push(gap);
    }

    return NextResponse.json({
      healthy: gaps.length === 0,
      gaps,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
