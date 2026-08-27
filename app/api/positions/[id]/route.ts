import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import type { PositionRow, PositionStatus } from "@/types/database";

const POSITION_STATUSES: PositionStatus[] = [
  "open",
  "closed",
  "assigned",
  "expired",
];

type PositionUpdate = Partial<
  Pick<
    PositionRow,
    "status" | "closed_at" | "shares_owned" | "cost_basis" | "premium_collected"
  >
>;

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseRouteClient();
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const updates: PositionUpdate = {};

  if ("status" in raw) {
    if (
      typeof raw.status !== "string" ||
      !POSITION_STATUSES.includes(raw.status as PositionStatus)
    ) {
      return NextResponse.json(
        { error: `status must be one of: ${POSITION_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    updates.status = raw.status as PositionStatus;
  }

  if ("closed_at" in raw) {
    if (raw.closed_at !== null && typeof raw.closed_at !== "string") {
      return NextResponse.json(
        { error: "closed_at must be a string or null" },
        { status: 400 }
      );
    }
    updates.closed_at = raw.closed_at;
  }

  for (const field of ["shares_owned", "cost_basis"] as const) {
    if (field in raw) {
      if (raw[field] !== null && typeof raw[field] !== "number") {
        return NextResponse.json(
          { error: `${field} must be a number or null` },
          { status: 400 }
        );
      }
      updates[field] = raw[field] as number | null;
    }
  }

  if ("premium_collected" in raw) {
    if (typeof raw.premium_collected !== "number") {
      return NextResponse.json(
        { error: "premium_collected must be a number" },
        { status: 400 }
      );
    }
    updates.premium_collected = raw.premium_collected;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      {
        error:
          "No updatable fields provided. Allowed: status, closed_at, shares_owned, cost_basis, premium_collected",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("positions")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ position: data });
}

/** Permanently removes a logged position -- for correcting a mis-entered log, not a routine "close" action (use POST .../close for that). */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseRouteClient();

  const { error } = await supabase.from("positions").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
