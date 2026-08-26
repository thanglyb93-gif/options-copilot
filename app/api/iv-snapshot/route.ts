import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { fetchNearestExpirationChain, fetchHistoricalCloses } from "@/lib/yahoo";
import { atmImpliedVolatility, historicalVolatility } from "@/lib/volatility";

interface SnapshotResult {
  ticker: string;
  status: "ok" | "skipped" | "error";
  error?: string;
}

async function runSnapshot(): Promise<{ date: string; results: SnapshotResult[] }> {
  const supabase = getSupabaseRouteClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: watchlist, error: watchlistError } = await supabase
    .from("watchlist")
    .select("ticker");

  if (watchlistError) {
    throw new Error(`Failed to read watchlist: ${watchlistError.message}`);
  }

  const results: SnapshotResult[] = [];

  for (const { ticker } of watchlist ?? []) {
    try {
      const [chain, closes] = await Promise.all([
        fetchNearestExpirationChain(ticker),
        fetchHistoricalCloses(ticker, 45),
      ]);

      if (chain.underlyingPrice == null) {
        results.push({ ticker, status: "skipped", error: "No underlying price" });
        continue;
      }

      const iv = atmImpliedVolatility({
        underlyingPrice: chain.underlyingPrice,
        calls: chain.calls,
        puts: chain.puts,
      });
      const hv = historicalVolatility(closes, 30);

      const { error: upsertError } = await supabase.from("iv_history").upsert(
        {
          ticker,
          date: today,
          implied_volatility_avg: iv,
          trailing_30d_hv: hv,
        },
        { onConflict: "ticker,date" }
      );

      results.push(
        upsertError
          ? { ticker, status: "error", error: upsertError.message }
          : { ticker, status: "ok" }
      );
    } catch (error) {
      results.push({
        ticker,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { date: today, results };
}

/**
 * Vercel Cron always invokes via GET, so the scheduled trigger in
 * vercel.json hits this handler. POST is kept too so the route can be
 * exercised manually/via curl per the spec.
 */
export async function GET() {
  try {
    return NextResponse.json(await runSnapshot());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(await runSnapshot());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
