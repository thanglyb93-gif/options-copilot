import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { gatherBriefingContext, getOrGenerateBriefing } from "@/lib/briefing-service";

export async function GET(
  request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const supabase = getSupabaseRouteClient();

  try {
    const { inputs } = await gatherBriefingContext(ticker);
    const { content, generatedAt, cached } = await getOrGenerateBriefing(
      supabase,
      ticker,
      inputs,
      forceRefresh
    );

    return NextResponse.json({ ticker, content, generatedAt, cached });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
