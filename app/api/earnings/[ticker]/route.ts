import { NextResponse } from "next/server";
import { getFinnhubClient } from "@/lib/finnhub";
import { fetchHistoricalCloses } from "@/lib/yahoo";
import { earningsCooldownFlag } from "@/lib/flags";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  try {
    const finnhub = getFinnhubClient();
    const today = new Date();
    const horizon = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000);

    const [calendar, closes] = await Promise.all([
      finnhub.getEarningsCalendar(ticker, toIsoDate(today), toIsoDate(horizon)),
      fetchHistoricalCloses(ticker, 30),
    ]);

    const upcoming = calendar.earningsCalendar
      .filter((event) => event.symbol === ticker)
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    const daysUntilEarnings = upcoming
      ? Math.max(
          0,
          Math.round(
            (new Date(upcoming.date).getTime() - today.getTime()) /
              (24 * 60 * 60 * 1000)
          )
        )
      : null;

    const cooldown = earningsCooldownFlag(closes);

    return NextResponse.json({
      ticker,
      nextEarningsDate: upcoming?.date ?? null,
      daysUntilEarnings,
      earningsCooldown: {
        flagged: cooldown.flagged,
        percentMoveLast10TradingDays: cooldown.percentMove,
      },
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
