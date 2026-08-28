import { NextResponse } from "next/server";
import {
  fetchHistoricalCloses,
  fetchQuote,
  fetchTargetExpirationChain,
  fetchNearestExpirationChain,
} from "@/lib/yahoo";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { unreliableIvFlag } from "@/lib/flags";
import { atmImpliedVolatility, hvPercentileRank } from "@/lib/volatility";
import { scoreIvComponent, IV_HISTORY_MIN_ROWS } from "@/lib/entry-score";
import { buildStrikeRows, calculateMaxPain, putCallRatio } from "@/lib/max-pain";

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const supabase = getSupabaseRouteClient();

  try {
    const [quote, targetChain, nearestChain, ivHistory, closes] = await Promise.all([
      fetchQuote(ticker),
      // Front-month (~37 DTE) IV, same expiration lib/iv-snapshot's cron
      // stores into iv_history -- keeps "current IV" comparable to the
      // historical series it's ranked against.
      fetchTargetExpirationChain(ticker),
      // Nearest expiration, same as /api/maxpain -- Max Pain and Put/Call
      // Ratio reuse that exact definition so this card's numbers match
      // what the ticker page itself shows.
      fetchNearestExpirationChain(ticker),
      supabase
        .from("iv_history")
        .select("implied_volatility_avg")
        .eq("ticker", ticker)
        .order("date", { ascending: true }),
      // Same window/source /api/quote uses for its own HV Percentile stat
      // -- available immediately (no accumulation period), used here as
      // this card's fallback while IV Percentile is still building
      // history, per the same convention lib/entry-score.ts's
      // scoreIvComponent already uses.
      fetchHistoricalCloses(ticker, 300),
    ]);

    const currentIv =
      targetChain.underlyingPrice != null
        ? atmImpliedVolatility({
            underlyingPrice: targetChain.underlyingPrice,
            calls: targetChain.calls.filter((c) => !unreliableIvFlag(c)),
            puts: targetChain.puts.filter((p) => !unreliableIvFlag(p)),
          })
        : null;

    const historicalValues = (ivHistory.data ?? [])
      .map((r) => r.implied_volatility_avg)
      .filter((v): v is number => typeof v === "number");

    const ivComponent = scoreIvComponent({ currentIv, historicalValues });
    const hvPercentile = hvPercentileRank(closes, 30).percentile;

    const strikes = buildStrikeRows(nearestChain.calls, nearestChain.puts);
    const maxPainStrike = calculateMaxPain(strikes);
    const putCall = putCallRatio(strikes);

    return NextResponse.json({
      ticker,
      name: quote.longName ?? quote.shortName ?? ticker,
      price: quote.regularMarketPrice ?? null,
      dayChangePercent: quote.regularMarketChangePercent ?? null,
      ivRank: {
        count: ivComponent.realHistoryCount,
        needed: IV_HISTORY_MIN_ROWS,
        percentile: ivComponent.percentile,
        hvPercentile,
      },
      maxPainStrike,
      putCallRatio: putCall,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
