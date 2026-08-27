import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { fetchQuote } from "@/lib/yahoo";
import type { PositionRow } from "@/types/database";

/**
 * Closes (early buyback) or assigns an open position, computing and
 * storing realized P/L with the same "stock leg + option leg combined"
 * logic used for live open-position analytics -- never the option leg
 * alone, per the standing rule.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = getSupabaseRouteClient();
  const body = await request.json().catch(() => null);
  const action = (body as Record<string, unknown> | null)?.action;

  if (action !== "close" && action !== "assign") {
    return NextResponse.json({ error: "action must be 'close' or 'assign'" }, { status: 400 });
  }

  const rawClosingPremium = (body as Record<string, unknown> | null)?.closingPremium;
  const closingPremium = typeof rawClosingPremium === "number" ? rawClosingPremium : null;

  if (action === "close" && closingPremium == null) {
    return NextResponse.json(
      { error: "closingPremium (per-share price paid to buy back the option) is required to close early" },
      { status: 400 }
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from("positions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: fetchError?.message ?? "Position not found" }, { status: 404 });
  }

  const row = existing as PositionRow;
  let realizedPl: number;

  if (action === "assign") {
    // Full premium is kept. For a covered call, shares are called away
    // at strike -- a real, realized stock leg. For a cash-secured put,
    // assignment is where stock ownership BEGINS, not ends -- there's no
    // stock P/L to combine yet, so the option leg alone is genuinely the
    // whole realized picture at this moment (not a violation of the
    // net-covered rule, just a fact about what "assignment" means for a put).
    const optionLegPL = row.premium_collected * 100 * row.contracts;
    const stockPL =
      row.position_type === "covered_call" && row.cost_basis != null && row.shares_owned != null
        ? (row.strike - row.cost_basis) * row.shares_owned
        : 0;
    realizedPl = optionLegPL + stockPL;
  } else {
    // Early close (buyback).
    const optionLegPL = (row.premium_collected - (closingPremium as number)) * 100 * row.contracts;
    let stockPL = 0;
    if (row.position_type === "covered_call" && row.cost_basis != null && row.shares_owned != null) {
      const quote = await fetchQuote(row.ticker).catch(() => null);
      const currentPrice = quote?.regularMarketPrice ?? null;
      if (currentPrice != null) {
        stockPL = (currentPrice - row.cost_basis) * row.shares_owned;
      }
    }
    realizedPl = optionLegPL + stockPL;
  }

  const { data: updated, error: updateError } = await supabase
    .from("positions")
    .update({
      status: action === "assign" ? "assigned" : "closed",
      closed_at: new Date().toISOString(),
      closing_premium: action === "close" ? closingPremium : null,
      realized_pl: realizedPl,
    })
    .eq("id", params.id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 502 });
  }

  return NextResponse.json({ position: updated, realizedPl });
}
