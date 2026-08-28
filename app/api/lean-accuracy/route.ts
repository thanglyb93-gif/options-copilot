import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";

const WINDOW_DAYS = 90;

export interface LeanAccuracyResponse {
  windowDays: number;
  tracked: number;
  heldUp: number;
  reversed: number;
  unclear: number;
  heldUpPct: number | null;
  pending: number;
}

export async function GET() {
  const supabase = getSupabaseRouteClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const [resolvedResult, pendingResult] = await Promise.all([
      supabase
        .from("lean_history")
        .select("outcome")
        .gte("date", since)
        .not("outcome", "is", null),
      supabase.from("lean_history").select("id", { count: "exact", head: true }).is("outcome", null),
    ]);

    if (resolvedResult.error) {
      throw new Error(resolvedResult.error.message);
    }
    if (pendingResult.error) {
      throw new Error(pendingResult.error.message);
    }

    const rows = resolvedResult.data ?? [];
    const heldUp = rows.filter((r) => r.outcome === "held_up").length;
    const reversed = rows.filter((r) => r.outcome === "reversed").length;
    const unclear = rows.filter((r) => r.outcome === "unclear").length;
    const tracked = rows.length;
    // Held-up rate is judged only against calls that took a real directional
    // stance -- "unclear" outcomes (thin/mixed evidence, or too small a move
    // to call either way) aren't failures of the lean, so they're excluded
    // from the denominator rather than counted against it.
    const judged = heldUp + reversed;

    const response: LeanAccuracyResponse = {
      windowDays: WINDOW_DAYS,
      tracked,
      heldUp,
      reversed,
      unclear,
      heldUpPct: judged > 0 ? (heldUp / judged) * 100 : null,
      pending: pendingResult.count ?? 0,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
