import { NextResponse } from "next/server";
import {
  fetchQuote,
  fetchHistoricalCloses,
  fetchTargetExpirationChain,
} from "@/lib/yahoo";
import { getFinnhubClient } from "@/lib/finnhub";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { earningsCooldownFlag, unreliableIvFlag } from "@/lib/flags";
import { atmImpliedVolatility, historicalVolatility } from "@/lib/volatility";

const MIN_HISTORY_DAYS = 20;

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
    const supabase = getSupabaseRouteClient();
    const today = new Date();
    const horizon = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000);

    const [quote, closes, calendar, targetChain, ivHistoryCount] = await Promise.all([
      fetchQuote(ticker),
      fetchHistoricalCloses(ticker, 45),
      finnhub.getEarningsCalendar(ticker, toIsoDate(today), toIsoDate(horizon)),
      fetchTargetExpirationChain(ticker),
      supabase
        .from("iv_history")
        .select("id", { count: "exact", head: true })
        .eq("ticker", ticker),
    ]);

    const price = quote.regularMarketPrice ?? null;
    const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh ?? null;
    const percentFrom52wHigh =
      price != null && fiftyTwoWeekHigh
        ? ((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100
        : null;

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

    const priceMoveFlag = earningsCooldownFlag(closes).flagged;
    const earningsSoon = daysUntilEarnings != null && daysUntilEarnings <= 3;

    const hv30 = historicalVolatility(closes, 30);
    const atmIv =
      targetChain.underlyingPrice != null
        ? atmImpliedVolatility({
            underlyingPrice: targetChain.underlyingPrice,
            calls: targetChain.calls.filter((c) => !unreliableIvFlag(c)),
            puts: targetChain.puts.filter((p) => !unreliableIvFlag(p)),
          })
        : null;
    const ivHvRatio = atmIv != null && hv30 != null && hv30 > 0 ? atmIv / hv30 : null;

    const count = ivHistoryCount.count ?? 0;

    return NextResponse.json({
      ticker,
      name: quote.longName ?? quote.shortName ?? ticker,
      price,
      dayChange: quote.regularMarketChange ?? null,
      dayChangePercent: quote.regularMarketChangePercent ?? null,
      percentFrom52wHigh,
      earningsCooldownFlagged: priceMoveFlag || earningsSoon,
      hv30,
      ivHvRatio,
      ivHistory: {
        count,
        needed: MIN_HISTORY_DAYS,
        hasEnoughHistory: count >= MIN_HISTORY_DAYS,
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
