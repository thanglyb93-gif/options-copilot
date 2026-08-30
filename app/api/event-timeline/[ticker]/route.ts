import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { getOrComputeEventTimeline, type EventTimelineWindow } from "@/lib/event-timeline";

/**
 * A first-ever (uncached) 3yr-window load can chain several parallelized
 * Finnhub + Claude round-trips -- extends past Vercel's default function
 * timeout budget, same reasoning as other multi-call routes in this app.
 */
export const maxDuration = 60;

const VALID_WINDOWS: readonly EventTimelineWindow[] = ["1w", "1mo", "3mo", "1yr", "3yr"];

export async function GET(request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const url = new URL(request.url);

  const windowParam = url.searchParams.get("window");
  const window: EventTimelineWindow = (VALID_WINDOWS as readonly string[]).includes(windowParam ?? "")
    ? (windowParam as EventTimelineWindow)
    : "3mo";
  const includeMacro = url.searchParams.get("includeMacro") === "true";

  const supabase = getSupabaseRouteClient();

  try {
    const { series, annotations } = await getOrComputeEventTimeline(supabase, ticker, window, includeMacro);

    return NextResponse.json({
      ticker,
      window,
      includeMacro,
      series: series.map((c) => ({ date: c.date, close: c.close })),
      annotations: annotations.map((a) => ({
        ticker: a.ticker,
        date: a.date,
        type: a.type,
        pctChange: a.pct_change,
        headline: a.headline,
        source: a.source,
        classification: a.classification,
      })),
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
