import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { daysToExpiration, fetchHistoricalCloses, fetchTargetExpirationChain } from "@/lib/yahoo";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { effectiveIvAndDelta } from "@/lib/options-math";
import {
  atmImpliedVolatility,
  historicalVolatility,
  rollingHistoricalVolatility,
  volatilitySkew,
  type SkewChainContract,
} from "@/lib/volatility";
import { gatherBriefingContext, getBriefingRespectingDailyCap } from "@/lib/briefing-service";
import type { DirectionalLean } from "@/lib/briefing";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import {
  evaluateRelativeStrength,
  RELATIVE_STRENGTH_FETCH_DAYS,
  type PeerHistoricals,
} from "@/lib/relative-strength";
import { scoreTickerLevel, type TradeDirection } from "@/lib/entry-score";
import { evaluateTimingCaution } from "@/lib/timing-caution";

/**
 * Ticker-level entry score only (IV Percentile + Events + Skew +
 * Relative Strength, 0-8 partial). Technical Setup is no longer computed
 * here -- it's per-strike (see /api/options's emCushion/cushionScore),
 * added client-side once a chain row is selected to complete this to a
 * 0-10 total.
 *
 * Phase 33 also computes Timing Caution alongside the score (a separate,
 * parallel signal -- see lib/timing-caution.ts) -- its own catalyst/
 * stabilization lookups can chain several Finnhub + Claude + Yahoo
 * round-trips, same reasoning as the Event Timeline route's maxDuration.
 */
export const maxDuration = 60;

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
        .select("date, implied_volatility_avg")
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

    const { daysSinceLastEarnings, recentHeadlineCount, closes } = context;

    // Goes through the same daily-cap-aware decision point Market Read
    // uses (Phase 43 Part C), so the global cap can't be bypassed just
    // by loading a ticker page instead of clicking Refresh. A stale
    // cached lean (capped/failed with fallback.cachedLean present) is
    // still used for scoring -- same "use whatever's cached regardless
    // of age" philosophy as Ranking's Phase 42 cache-only path -- and
    // only a ticker with NO lean ever cached scores directional
    // alignment as fully absent (0, not opposing).
    const outcome = await getBriefingRespectingDailyCap(supabase, ticker, context, false);
    let lean: DirectionalLean | null = null;
    let rationale: string | null = null;
    if (outcome.fallback) {
      lean = outcome.fallback.cachedLean?.lean ?? null;
      rationale = outcome.fallback.cachedLean?.rationale ?? null;
    } else {
      lean = outcome.content.directionalLean.lean;
      rationale = outcome.content.directionalLean.rationale;
    }

    // Both the IV Component's ATM IV and Skew need each contract's
    // EFFECTIVE IV, via the same reliability + lastPrice-fallback
    // solving /api/options uses per display row (lib/options-math.ts's
    // effectiveIvAndDelta) -- not a bare live-bid/ask-only check, which
    // would zero out every contract (and therefore both components)
    // whenever the market's closed, which is most of the time this
    // page gets loaded.
    const dte = daysToExpiration(targetChain.expirationDate);

    const toEffectiveIvContract = (contract: CallOrPut, optionType: "call" | "put") => {
      const { effectiveIv, ivUnreliable } = effectiveIvAndDelta(
        contract,
        optionType,
        targetChain.underlyingPrice,
        dte,
        targetChain.marketState
      );
      return { strike: contract.strike, impliedVolatility: ivUnreliable ? undefined : effectiveIv ?? undefined };
    };

    const currentIv =
      targetChain.underlyingPrice != null
        ? atmImpliedVolatility({
            underlyingPrice: targetChain.underlyingPrice,
            calls: targetChain.calls.map((c) => toEffectiveIvContract(c, "call")),
            puts: targetChain.puts.map((p) => toEffectiveIvContract(p, "put")),
          })
        : null;

    // Skew is computed against the full contract set, same as
    // /api/options: volatilitySkew itself only accepts candidates with
    // a real delta.
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

    const ivHistoryWithDates = (ivHistory.data ?? [])
      .filter((r): r is { date: string; implied_volatility_avg: number } => typeof r.implied_volatility_avg === "number")
      .map((r) => ({ date: r.date, iv: r.implied_volatility_avg }));

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
        lean,
        rationale,
        daysSinceLastEarnings,
        recentHeadlineCount,
      },
      skew,
      { evaluation: relativeStrengthEvaluation, sectorGroupName: group?.name ?? null }
    );

    // Phase 33 -- a separate, parallel signal attached to the score
    // display; never folded into `result`'s own scoring math above.
    // Its catalyst lookup can itself hit headline classification (an
    // Anthropic call) -- a failure there must not take down the score
    // either, so this degrades to "no caution to show" rather than
    // throwing.
    let timingCaution: Awaited<ReturnType<typeof evaluateTimingCaution>> = { active: false, reasoning: [] };
    try {
      timingCaution = await evaluateTimingCaution(supabase, ticker, direction as TradeDirection, {
        historicals: tickerCloses,
        currentIv,
        ivHistory: ivHistoryWithDates,
      });
    } catch (error) {
      console.error(`Timing caution evaluation failed for ${ticker}:`, error);
    }

    return NextResponse.json({
      ticker,
      direction,
      ...result,
      timingCaution,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Entry score failed for ${ticker}:`, error);
    return NextResponse.json(
      { error: "Couldn't compute a score for this ticker right now." },
      { status: 502 }
    );
  }
}
