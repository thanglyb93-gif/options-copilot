import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { gatherTodaysSummaryContext, getOrGenerateTodaysSummary } from "@/lib/briefing-service";

export async function GET(request: Request) {
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const supabase = getSupabaseRouteClient();

  try {
    const { inputs, headlines } = await gatherTodaysSummaryContext(supabase);
    const { content, generatedAt, cached } = await getOrGenerateTodaysSummary(
      supabase,
      inputs,
      forceRefresh
    );

    return NextResponse.json({
      content,
      generatedAt,
      cached,
      headlines,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
