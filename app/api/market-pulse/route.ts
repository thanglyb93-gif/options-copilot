import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { gatherMarketPulseContext, getOrGenerateMarketPulse } from "@/lib/briefing-service";

export async function GET(request: Request) {
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const supabase = getSupabaseRouteClient();

  try {
    const { inputs, headlines } = await gatherMarketPulseContext();
    const { content, generatedAt, cached } = await getOrGenerateMarketPulse(
      supabase,
      inputs,
      forceRefresh
    );

    return NextResponse.json({
      content,
      generatedAt,
      cached,
      headlines: headlines.map((h) => ({
        headline: h.headline,
        source: h.source,
        url: h.url,
        summary: h.summary,
        publishedAt: new Date(h.datetime * 1000).toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
