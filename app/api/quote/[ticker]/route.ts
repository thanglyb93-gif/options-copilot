import { NextResponse } from "next/server";
import {
  fetchQuote,
  fetchQuoteSummaryExtras,
  fetchHistoricalCloses,
  simpleMovingAverage,
} from "@/lib/yahoo";
import { historicalVolatility } from "@/lib/volatility";

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  try {
    const [quote, extras, closes] = await Promise.all([
      fetchQuote(ticker),
      fetchQuoteSummaryExtras(ticker),
      fetchHistoricalCloses(ticker, 300),
    ]);

    const price = quote.regularMarketPrice ?? null;
    const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh ?? null;
    const percentFrom52wHigh =
      price != null && fiftyTwoWeekHigh
        ? ((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100
        : null;

    return NextResponse.json({
      ticker,
      price,
      dayChange: quote.regularMarketChange ?? null,
      dayChangePercent: quote.regularMarketChangePercent ?? null,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
      percentFrom52wHigh,
      peRatioTrailing: quote.trailingPE ?? null,
      peRatioForward: quote.forwardPE ?? null,
      marketCap: quote.marketCap ?? null,
      dividendYield: quote.dividendYield ?? null,
      nextExDividendDate: extras.dividendCalendar.exDividendDate ?? null,
      beta: extras.beta ?? quote.beta ?? null,
      analystTargets: extras.analystTargets,
      sma20: simpleMovingAverage(closes, 20),
      sma50: simpleMovingAverage(closes, 50),
      sma200: simpleMovingAverage(closes, 200),
      hv30: historicalVolatility(closes, 30),
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
