import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { getOrGenerateInsiderActivity } from "@/lib/insider-service";

export async function GET(request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const supabase = getSupabaseRouteClient();

  try {
    const { summary, generatedAt, cached } = await getOrGenerateInsiderActivity(supabase, ticker, forceRefresh);
    return NextResponse.json({ ticker, summary, generatedAt, cached });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
