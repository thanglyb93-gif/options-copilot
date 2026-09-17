import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { gatherTodaysSummaryContext, getOrGenerateTodaysSummary } from "@/lib/briefing-service";

export async function GET(request: Request) {
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const supabase = getSupabaseRouteClient();

  try {
    const { inputs, headlines } = await gatherTodaysSummaryContext(supabase);

    // The headlines above are already real and resilient (a failed
    // classification batch just falls back to an unclassified headline,
    // never an exception) -- so a summary-generation failure specifically
    // (Anthropic out of credits, rate limited, network issue) shouldn't
    // take the headlines down with it. The News page still renders the
    // categorized headline groups with content: null; see
    // components/news/todays-summary-panel.tsx for the calm fallback.
    try {
      const { content, generatedAt, cached } = await getOrGenerateTodaysSummary(
        supabase,
        inputs,
        forceRefresh
      );
      return NextResponse.json({ content, generatedAt, cached, headlines });
    } catch (error) {
      console.error("Today's Summary generation failed:", error);
      return NextResponse.json({ content: null, generatedAt: null, cached: false, headlines });
    }
  } catch (error) {
    console.error("Failed to load today's news:", error);
    return NextResponse.json({ error: "Couldn't load today's news right now." }, { status: 502 });
  }
}
