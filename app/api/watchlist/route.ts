import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabaseRouteClient();

  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ watchlist: data });
}

export async function POST(request: Request) {
  const supabase = getSupabaseRouteClient();
  const body = await request.json().catch(() => null);
  const ticker =
    typeof body?.ticker === "string" ? body.ticker.trim().toUpperCase() : null;

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert({ ticker })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ watchlist: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = getSupabaseRouteClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  const { error } = await supabase.from("watchlist").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
