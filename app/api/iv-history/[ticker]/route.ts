import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";

const MIN_HISTORY_DAYS = 20;

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const supabase = getSupabaseRouteClient();

  const { data, error } = await supabase
    .from("iv_history")
    .select("date, implied_volatility_avg, trailing_30d_hv")
    .eq("ticker", ticker)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const rows = data ?? [];
  const ivValues = rows
    .map((r) => r.implied_volatility_avg)
    .filter((v): v is number => typeof v === "number");

  return NextResponse.json({
    ticker,
    count: rows.length,
    needed: MIN_HISTORY_DAYS,
    hasEnoughHistory: rows.length >= MIN_HISTORY_DAYS,
    ivValues,
    rows,
  });
}
