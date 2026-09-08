import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import {
  computeThreeMonthRange,
  fetchHistoricalCloses,
  fetchOptionsChainWithinDays,
  simpleMovingAverage,
} from "@/lib/yahoo";
import { computeRoll } from "@/lib/roll-calculator";

/**
 * Rolling "out" can reasonably target a later expiration than the 60-day
 * window /api/options's main Strike Selector fetch uses -- wide enough to
 * cover a real roll-out choice without inflating the default case.
 */
const MAX_CHAIN_DAYS = 90;
const HISTORICAL_CLOSES_DAYS = 300;

export async function GET(request: Request, { params }: { params: { positionId: string } }) {
  const supabase = getSupabaseRouteClient();
  const { searchParams } = new URL(request.url);

  const newStrike = Number(searchParams.get("newStrike"));
  const newExpiration = searchParams.get("newExpiration");

  if (!Number.isFinite(newStrike) || !newExpiration) {
    return NextResponse.json(
      { error: "newStrike and newExpiration query params are required" },
      { status: 400 }
    );
  }

  const { data: position, error } = await supabase
    .from("positions")
    .select("*")
    .eq("id", params.positionId)
    .eq("status", "open")
    .single();

  if (error || !position) {
    return NextResponse.json({ error: "Open position not found" }, { status: 404 });
  }

  try {
    const [chain, closes] = await Promise.all([
      fetchOptionsChainWithinDays(position.ticker, MAX_CHAIN_DAYS),
      fetchHistoricalCloses(position.ticker, HISTORICAL_CLOSES_DAYS),
    ]);

    if (chain.underlyingPrice == null) {
      return NextResponse.json({ error: "No live price available for this ticker" }, { status: 502 });
    }

    const sma50 = simpleMovingAverage(closes, 50);
    const ninetyDayRange = computeThreeMonthRange(closes);

    const comparison = computeRoll(
      {
        positionType: position.position_type,
        strike: position.strike,
        expirationDate: position.expiration_date,
        premiumCollected: position.premium_collected,
        contracts: position.contracts,
      },
      newStrike,
      newExpiration,
      {
        chain,
        underlyingPrice: chain.underlyingPrice,
        sma50,
        ninetyDayLow: ninetyDayRange?.low ?? null,
        ninetyDayHigh: ninetyDayRange?.high ?? null,
      }
    );

    return NextResponse.json({
      positionId: position.id,
      ticker: position.ticker,
      positionType: position.position_type,
      underlyingPrice: chain.underlyingPrice,
      currentStrike: position.strike,
      currentExpirationDate: position.expiration_date,
      newStrike,
      newExpiration,
      ...comparison,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 }
    );
  }
}
