import { NextResponse } from "next/server";
import { fetchHistoricalCloses } from "@/lib/yahoo";
import { runSimulatedBacktest } from "@/lib/simulated-backtest";
import type { TradeDirection } from "@/lib/entry-score";

/** Covers the 6-entry x 30-day-spacing window plus HV trailing buffer plus forward-walk buffer, with room to spare for weekends/holidays. */
const HISTORY_FETCH_DAYS = 300;

export async function GET(request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const url = new URL(request.url);
  const directionParam = url.searchParams.get("direction");
  const direction: TradeDirection = directionParam === "call" ? "call" : "put";
  const monthsParam = Number(url.searchParams.get("months"));
  const lookbackMonths = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 6;

  try {
    const historicals = await fetchHistoricalCloses(ticker, HISTORY_FETCH_DAYS);
    const result = runSimulatedBacktest(ticker, historicals, direction, lookbackMonths);

    return NextResponse.json({ ...result, asOf: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
