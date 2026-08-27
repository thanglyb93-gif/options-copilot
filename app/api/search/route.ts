import { NextResponse } from "next/server";
import { fetchSearchResults } from "@/lib/yahoo";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ query: "", matches: [] });
  }

  try {
    const matches = await fetchSearchResults(q);
    return NextResponse.json({ query: q, matches });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
