import { NextResponse } from "next/server";
import { fetchNearestExpirationChain } from "@/lib/yahoo";
import { buildStrikeRows, calculateMaxPain } from "@/lib/max-pain";

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  try {
    const chain = await fetchNearestExpirationChain(ticker);
    const strikes = buildStrikeRows(chain.calls, chain.puts);
    const maxPainStrike = calculateMaxPain(strikes);

    return NextResponse.json({
      ticker,
      expirationDate: chain.expirationDate.toISOString().slice(0, 10),
      underlyingPrice: chain.underlyingPrice ?? null,
      maxPainStrike,
      strikes,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
