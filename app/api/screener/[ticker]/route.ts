import { NextResponse } from "next/server";
import { fetchHistoricalCloses, fetchQuote } from "@/lib/yahoo";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import {
  describeRelativeStrength,
  evaluateRelativeStrength,
  RELATIVE_STRENGTH_FETCH_DAYS,
  type PeerHistoricals,
} from "@/lib/relative-strength";

export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();

  try {
    const group = sectorGroupForTicker(ticker);
    const peerTickers = peerTickersFor(ticker);

    const [quote, tickerCloses, spyCloses, peerResults] = await Promise.all([
      fetchQuote(ticker),
      fetchHistoricalCloses(ticker, RELATIVE_STRENGTH_FETCH_DAYS),
      fetchHistoricalCloses("SPY", RELATIVE_STRENGTH_FETCH_DAYS),
      Promise.all(
        peerTickers.map(async (peerTicker): Promise<PeerHistoricals | null> => {
          try {
            const closes = await fetchHistoricalCloses(peerTicker, RELATIVE_STRENGTH_FETCH_DAYS);
            return { ticker: peerTicker, closes };
          } catch {
            // One peer failing to fetch shouldn't break the whole
            // comparison -- the peer average just uses whichever peers
            // succeeded (computeRelativeStrength already filters nulls).
            return null;
          }
        })
      ),
    ]);

    const peerHistoricals = peerResults.filter((p): p is PeerHistoricals => p != null);

    const evaluation = evaluateRelativeStrength(
      ticker,
      tickerCloses,
      spyCloses,
      group ? peerHistoricals : null
    );

    const summary = describeRelativeStrength(evaluation, group?.name ?? null);

    return NextResponse.json({
      ticker,
      name: quote.longName ?? quote.shortName ?? ticker,
      price: quote.regularMarketPrice ?? null,
      dayChangePercent: quote.regularMarketChangePercent ?? null,
      evaluation,
      sectorGroup: group ? { name: group.name, peers: group.peers, benchmarkEtf: group.benchmarkEtf } : null,
      summary,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
