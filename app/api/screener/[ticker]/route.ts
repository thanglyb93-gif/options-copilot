import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { fetchHistoricalCloses, fetchQuote, fetchTargetExpirationChain, daysToExpiration } from "@/lib/yahoo";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import {
  describeRelativeStrength,
  evaluateRelativeStrength,
  RELATIVE_STRENGTH_FETCH_DAYS,
  type PeerHistoricals,
} from "@/lib/relative-strength";
import { effectiveIvAndDelta } from "@/lib/options-math";
import { volatilitySkew, type SkewChainContract, type VolatilitySkewResult } from "@/lib/volatility";

/**
 * Front-month chain, delta-mapped just enough for volatilitySkew's input
 * -- the same effectiveIvAndDelta computation app/api/options/[ticker]
 * uses per row, scoped here to only what the skew read needs (no theta,
 * cushion, spread, etc -- this route isn't the Strike Selector).
 */
async function fetchSkew(ticker: string): Promise<VolatilitySkewResult | null> {
  const chain = await fetchTargetExpirationChain(ticker).catch(() => null);
  if (!chain) return null;
  const dte = daysToExpiration(chain.expirationDate);

  const mapDelta = (contract: CallOrPut, optionType: "call" | "put"): SkewChainContract => {
    const { effectiveIv, ivUnreliable, delta } = effectiveIvAndDelta(
      contract,
      optionType,
      chain.underlyingPrice,
      dte,
      chain.marketState
    );
    return { delta, impliedVolatility: ivUnreliable ? null : effectiveIv };
  };

  return volatilitySkew({
    calls: chain.calls.map((c) => mapDelta(c, "call")),
    puts: chain.puts.map((p) => mapDelta(p, "put")),
  });
}

export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();

  try {
    const group = sectorGroupForTicker(ticker);
    const peerTickers = peerTickersFor(ticker);

    const [quote, tickerCloses, spyCloses, peerResults, volatilitySkewResult] = await Promise.all([
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
      // Skew is supplementary color on this page (unlike the ticker page,
      // where it's a scored Entry Score input) -- a chain fetch failure
      // shouldn't break the whole Screener evaluation, so this degrades
      // to null rather than propagating.
      fetchSkew(ticker).catch(() => null),
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
      volatilitySkew: volatilitySkewResult,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
