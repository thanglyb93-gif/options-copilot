import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { daysToExpiration, fetchHistoricalCloses, fetchTargetExpirationChain } from "@/lib/yahoo";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { unreliableIvFlag } from "@/lib/flags";
import { effectiveIvAndDelta } from "@/lib/options-math";
import {
  atmImpliedVolatility,
  historicalVolatility,
  rollingHistoricalVolatility,
  volatilitySkew,
  type SkewChainContract,
} from "@/lib/volatility";
import { gatherBriefingContext, getOrGenerateBriefing } from "@/lib/briefing-service";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import {
  evaluateRelativeStrength,
  RELATIVE_STRENGTH_FETCH_DAYS,
  type PeerHistoricals,
} from "@/lib/relative-strength";
import { scoreTickerLevel, type TradeDirection } from "@/lib/entry-score";

/**
 * Ticker-level entry score only (IV Percentile + Events + Skew +
 * Relative Strength, 0-8 partial). Technical Setup is no longer computed
 * here -- it's per-strike (see /api/options's emCushion/cushionScore),
 * added client-side once a chain row is selected to complete this to a
 * 0-10 total.
 */
export async function GET(
  request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const direction = new URL(request.url).searchParams.get("direction");

  if (direction !== "put" && direction !== "call") {
    return NextResponse.json(
      { error: "direction query param must be 'put' or 'call'" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseRouteClient();

  try {
    const group = sectorGroupForTicker(ticker);
    const peerTickers = peerTickersFor(ticker);

    const [context, targetChain, ivHistory, tickerCloses, spyCloses, peerResults] = await Promise.all([
      gatherBriefingContext(ticker),
      fetchTargetExpirationChain(ticker),
      supabase
        .from("iv_history")
        .select("implied_volatility_avg")
        .eq("ticker", ticker)
        .order("date", { ascending: true }),
      fetchHistoricalCloses(ticker, RELATIVE_STRENGTH_FETCH_DAYS),
      fetchHistoricalCloses("SPY", RELATIVE_STRENGTH_FETCH_DAYS),
      Promise.all(
        peerTickers.map(async (peerTicker): Promise<PeerHistoricals | null> => {
          try {
            const closes = await fetchHistoricalCloses(peerTicker, RELATIVE_STRENGTH_FETCH_DAYS);
            return { ticker: peerTicker, closes };
          } catch {
            // One peer failing to fetch shouldn't break the whole
            // comparison -- same graceful-degradation contract as the
            // Screener's route (evaluateRelativeStrength already
            // filters nulls out of the peer average).
            return null;
          }
        })
      ),
    ]);

    const { inputs, daysSinceLastEarnings, recentHeadlineCount, closes } = context;

    const { content: briefing } = await getOrGenerateBriefing(supabase, ticker, inputs, false);

    const reliableCalls = targetChain.calls.filter((c) => !unreliableIvFlag(c));
    const reliablePuts = targetChain.puts.filter((p) => !unreliableIvFlag(p));

    const currentIv =
      targetChain.underlyingPrice != null
        ? atmImpliedVolatility({ underlyingPrice: targetChain.underlyingPrice, calls: reliableCalls, puts: reliablePuts })
        : null;

    // Skew needs each contract's delta, computed via the exact same
    // reliability + lastPrice-fallback IV-solving logic /api/options
    // uses per display row (lib/options-math.ts's effectiveIvAndDelta) --
    // not the ATM-IV-only unreliableIvFlag filter above, which requires
    // a genuinely live bid/ask and would zero out every contract (and
    // therefore this component) whenever the market's closed. Skew is
    // computed against the full contract set, same as /api/options:
    // volatilitySkew itself only accepts candidates with a real delta.
    const dte = daysToExpiration(targetChain.expirationDate);
    const toSkewContract = (contract: CallOrPut, optionType: "call" | "put"): SkewChainContract => {
      const { effectiveIv, delta } = effectiveIvAndDelta(
        contract,
        optionType,
        targetChain.underlyingPrice,
        dte,
        targetChain.marketState
      );
      return { delta, impliedVolatility: effectiveIv };
    };
    const skew = volatilitySkew({
      calls: targetChain.calls.map((c) => toSkewContract(c, "call")),
      puts: targetChain.puts.map((p) => toSkewContract(p, "put")),
    });

    const historicalValues = (ivHistory.data ?? [])
      .map((r) => r.implied_volatility_avg)
      .filter((v): v is number => typeof v === "number");

    // Approximate stand-in while historicalValues is thin -- built purely
    // from already-fetched daily closes, no extra data source needed.
    const hvFallback = {
      currentHv: historicalVolatility(closes, 30),
      hvSeries: rollingHistoricalVolatility(closes, 30),
    };

    const peerHistoricals = peerResults.filter((p): p is PeerHistoricals => p != null);
    const relativeStrengthEvaluation = evaluateRelativeStrength(
      ticker,
      tickerCloses,
      spyCloses,
      group ? peerHistoricals : null
    );

    const result = scoreTickerLevel(
      direction as TradeDirection,
      { currentIv, historicalValues, hvFallback },
      {
        lean: briefing.directionalLean.lean,
        rationale: briefing.directionalLean.rationale,
        daysSinceLastEarnings,
        recentHeadlineCount,
      },
      skew,
      { evaluation: relativeStrengthEvaluation, sectorGroupName: group?.name ?? null }
    );

    return NextResponse.json({
      ticker,
      direction,
      ...result,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
