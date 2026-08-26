import { NextResponse } from "next/server";
import { fetchNearestExpirationChain } from "@/lib/yahoo";
import { calculateMaxPain, type StrikeOpenInterest } from "@/lib/max-pain";

function buildStrikeRows(
  calls: { strike: number; openInterest?: number }[],
  puts: { strike: number; openInterest?: number }[]
): StrikeOpenInterest[] {
  const byStrike = new Map<number, StrikeOpenInterest>();

  for (const call of calls) {
    const row = byStrike.get(call.strike) ?? {
      strike: call.strike,
      callOpenInterest: 0,
      putOpenInterest: 0,
    };
    row.callOpenInterest += call.openInterest ?? 0;
    byStrike.set(call.strike, row);
  }

  for (const put of puts) {
    const row = byStrike.get(put.strike) ?? {
      strike: put.strike,
      callOpenInterest: 0,
      putOpenInterest: 0,
    };
    row.putOpenInterest += put.openInterest ?? 0;
    byStrike.set(put.strike, row);
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

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
