import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { gatherBriefingContext, getBriefingRespectingDailyCap } from "@/lib/briefing-service";
import { getDailyGenerationStatus } from "@/lib/market-read-cap";

export async function GET(
  request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const supabase = getSupabaseRouteClient();

  try {
    const context = await gatherBriefingContext(ticker);
    const outcome = await getBriefingRespectingDailyCap(supabase, ticker, context, forceRefresh);
    // Re-read after the call above (rather than reusing a status read
    // from inside it) so a request that just generated and incremented
    // the counter reports its own up-to-date count, not a stale one.
    const dailyStatus = await getDailyGenerationStatus(supabase);

    return NextResponse.json({
      ticker,
      mode: outcome.mode,
      content: outcome.content,
      generatedAt: outcome.generatedAt,
      fallback: outcome.fallback,
      dailyStatus,
    });
  } catch (error) {
    // Never surface the raw error (an Anthropic failure's message can be
    // the literal API error body) -- log it, return something a calm UI
    // fallback can show instead. See components/ticker/market-read-panel.tsx.
    console.error(`Market Read failed for ${ticker}:`, error);
    return NextResponse.json(
      { error: "Market Read unavailable right now." },
      { status: 502 }
    );
  }
}
