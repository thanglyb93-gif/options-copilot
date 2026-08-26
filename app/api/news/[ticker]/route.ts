import { NextResponse } from "next/server";
import { getFinnhubClient } from "@/lib/finnhub";

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
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);

    const news = await finnhub.getCompanyNews(ticker, toIsoDate(from), toIsoDate(to));

    const headlines = news
      .slice()
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 10)
      .map((item) => ({
        headline: item.headline,
        source: item.source,
        url: item.url,
        summary: item.summary,
        publishedAt: new Date(item.datetime * 1000).toISOString(),
      }));

    return NextResponse.json({
      ticker,
      headlines,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
