import { NextResponse } from "next/server";
import { fetchTargetExpirationChain } from "@/lib/yahoo";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { unreliableIvFlag } from "@/lib/flags";
import { atmImpliedVolatility } from "@/lib/volatility";
import { gatherBriefingContext, getOrGenerateBriefing } from "@/lib/briefing-service";
import { scoreTickerLevel, type TradeDirection } from "@/lib/entry-score";

/**
 * Ticker-level entry score only (IV Percentile + Events, 0-4 partial).
 * Technical Setup is no longer computed here -- it's per-strike (see
 * /api/options's emCushion/cushionScore), added client-side once a chain
 * row is selected to complete this to a 0-6 total.
 */
export async function GET(
  request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const direction = new URL(request.url).searchParams.get("direction");

  if (direction !== "put" && direction !== "call") {
    return NextResponse.json(
      { error: "direction query param must be 'put' or 'call'" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseRouteClient();

  try {
    const [context, targetChain, ivHistory] = await Promise.all([
      gatherBriefingContext(ticker),
      fetchTargetExpirationChain(ticker),
      supabase
        .from("iv_history")
        .select("implied_volatility_avg")
        .eq("ticker", ticker)
        .order("date", { ascending: true }),
    ]);

    const { inputs, daysSinceLastEarnings, recentHeadlineCount } = context;

    const { content: briefing } = await getOrGenerateBriefing(supabase, ticker, inputs, false);

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

    const result = scoreTickerLevel(
      direction as TradeDirection,
      { currentIv, historicalValues },
      {
        lean: briefing.directionalLean.lean,
        rationale: briefing.directionalLean.rationale,
        daysSinceLastEarnings,
        recentHeadlineCount,
      }
    );

    return NextResponse.json({
      ticker,
      direction,
      ...result,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
