import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import type { AlertLogRow } from "@/types/database";

/** Recent alert_log entries, most-recent-first -- read-only, for the Positions page's "Alerts" confirmation list. */
const RECENT_LIMIT = 25;

export async function GET() {
  const supabase = getSupabaseRouteClient();

  const { data, error } = await supabase
    .from("alert_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const rows = (data ?? []) as AlertLogRow[];

  return NextResponse.json({
    alerts: rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      headlineHash: r.headline_hash,
      sentAt: r.sent_at,
    })),
  });
}
