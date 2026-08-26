import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import type { PositionStatus, PositionType } from "@/types/database";

const POSITION_TYPES: PositionType[] = ["covered_call", "cash_secured_put"];
const POSITION_STATUSES: PositionStatus[] = [
  "open",
  "closed",
  "assigned",
  "expired",
];

export async function GET(request: Request) {
  const supabase = getSupabaseRouteClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  if (status && !POSITION_STATUSES.includes(status as PositionStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${POSITION_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  let query = supabase
    .from("positions")
    .select("*")
    .order("opened_at", { ascending: false });

  if (status) {
    query = query.eq("status", status as PositionStatus);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ positions: data });
}

export async function POST(request: Request) {
  const supabase = getSupabaseRouteClient();
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    ticker,
    position_type,
    shares_owned,
    cost_basis,
    strike,
    premium_collected,
    expiration_date,
    contracts,
  } = body as Record<string, unknown>;

  if (
    typeof ticker !== "string" ||
    typeof position_type !== "string" ||
    !POSITION_TYPES.includes(position_type as PositionType) ||
    typeof strike !== "number" ||
    typeof premium_collected !== "number" ||
    typeof expiration_date !== "string" ||
    typeof contracts !== "number"
  ) {
    return NextResponse.json(
      {
        error:
          "ticker, position_type ('covered_call'|'cash_secured_put'), strike, premium_collected, expiration_date, contracts are required",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("positions")
    .insert({
      ticker: ticker.toUpperCase(),
      position_type: position_type as PositionType,
      shares_owned: typeof shares_owned === "number" ? shares_owned : null,
      cost_basis: typeof cost_basis === "number" ? cost_basis : null,
      strike,
      premium_collected,
      expiration_date,
      contracts,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ position: data }, { status: 201 });
}
