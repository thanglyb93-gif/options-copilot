import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { fetchTargetExpirationChain, fetchHistoricalCloses, daysToExpiration } from "@/lib/yahoo";
import { atmImpliedVolatility, historicalVolatility } from "@/lib/volatility";
import { effectiveIvAndDelta, type OptionType } from "@/lib/options-math";
import { sendIvSnapshotFailureAlert } from "@/lib/alerts";

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
      // Front-month (~37 DTE, the 30-45 DTE band this app screens for) --
      // not the literal nearest expiration, which is frequently a dead
      // weekly with no real market and garbage near-zero IV (same issue
      // fixed elsewhere in /api/options and /api/watchlist-summary).
      const [chain, closes] = await Promise.all([
        fetchTargetExpirationChain(ticker),
        fetchHistoricalCloses(ticker, 45),
      ]);

      if (chain.underlyingPrice == null) {
        results.push({ ticker, status: "skipped", error: "No underlying price" });
        continue;
      }

      // This cron runs at 21:00 UTC (vercel.json) -- at or after regular
      // market close every single day, so chain.marketState here is
      // essentially never "REGULAR." A bare live-bid/ask-only filter
      // zeroes out every contract in that state, which would have been
      // silently storing a null IV snapshot for every ticker, every day
      // -- the same market-hours-aware effective-IV solving used
      // elsewhere (lib/options-math.ts's effectiveIvAndDelta) instead
      // falls back to solving IV from each contract's real lastPrice.
      const chainDte = daysToExpiration(chain.expirationDate);
      const toEffectiveIvContract = (contract: CallOrPut, optionType: OptionType) => {
        const { effectiveIv, ivUnreliable } = effectiveIvAndDelta(
          contract,
          optionType,
          chain.underlyingPrice,
          chainDte,
          chain.marketState
        );
        return { strike: contract.strike, impliedVolatility: ivUnreliable ? undefined : effectiveIv ?? undefined };
      };
      const iv = atmImpliedVolatility({
        underlyingPrice: chain.underlyingPrice,
        calls: chain.calls.map((c) => toEffectiveIvContract(c, "call")),
        puts: chain.puts.map((p) => toEffectiveIvContract(p, "put")),
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

  const failures = results
    .filter((r) => r.status !== "ok")
    .map((r) => ({ ticker: r.ticker, status: r.status as "skipped" | "error", error: r.error }));

  if (failures.length > 0) {
    // Best-effort, time-boxed -- must never risk the route's own timeout
    // (Vercel Hobby cron gives this 10s total) or turn an email problem
    // into a snapshot-run problem.
    await sendIvSnapshotFailureAlert(today, failures);
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
