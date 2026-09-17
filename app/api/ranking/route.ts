import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { getSupabaseRouteClient } from "@/lib/supabase";
import type { Database } from "@/types/database";
import { daysToExpiration, fetchHistoricalCloses, fetchOptionsChainWithinDays } from "@/lib/yahoo";
import { findClosestDteIndex, effectiveIvAndDelta, type OptionType } from "@/lib/options-math";
import { atmImpliedVolatility, historicalVolatility, rollingHistoricalVolatility, volatilitySkew, type SkewChainContract, type VolatilitySkewResult } from "@/lib/volatility";
import { expectedMove, strikeCushion, cushionScore, momentumBufferMultiplier } from "@/lib/expected-move";
import { scoreTickerLevel, combineWithStrikeCushion, type TradeDirection } from "@/lib/entry-score";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import { evaluateRelativeStrength, RELATIVE_STRENGTH_FETCH_DAYS, type PeerHistoricals, type RelativeStrengthEvaluation } from "@/lib/relative-strength";
import { gatherBriefingContext, getCachedBriefingOnly } from "@/lib/briefing-service";
import { findNearestExpiration, findNearestStrike, mapWithConcurrency, type AvailableExpiration } from "@/lib/ranking";
import type { RankingTickerResult } from "@/types/api";

/**
 * Phase 41 -- batch Entry Score computation across the whole watchlist
 * at a user-chosen target strike distance/expiration. Per ticker, this
 * runs essentially the same pipeline /api/entry-score already runs
 * (ticker-level IV/Events/Skew/Relative Strength) plus the per-strike
 * Technical/EM Cushion check /api/options runs for a specific chain
 * row -- reused directly, not reimplemented -- just resolved against
 * THIS ticker's own actual chain for the requested target instead of a
 * client-selected strike. Deliberately does NOT compute Timing Caution
 * (Phase 33) for every ticker -- that's a real, separate Finnhub +
 * long-historicals cost per ticker that Part D's UI doesn't surface
 * here anyway; checking an individual ticker's own page still shows it.
 */
export const maxDuration = 60;

/** Bounds concurrent per-ticker pipelines so a large watchlist doesn't fire 20+ simultaneous chain fetches at once. */
const CONCURRENCY = 6;

/** Options chain fetched wide enough to cover both the ~37 DTE front-month (ticker-level IV component) and the user's requested target DTE. */
function chainFetchDays(targetDte: number): number {
  return Math.max(60, targetDte + 20);
}

interface HolderPosition {
  totalShares: number;
  costBasis: number | null;
}

/** Exact same prefill pattern as app/api/compare/[ticker]/route.ts's resolveHolderPosition (Phase 26/27) -- a real tracked position's cost basis is never overridable by a client-supplied value. */
async function resolveHolderPosition(supabase: SupabaseClient<Database>, ticker: string): Promise<HolderPosition | null> {
  const { data, error } = await supabase
    .from("positions")
    .select("shares_owned, cost_basis")
    .eq("ticker", ticker)
    .eq("status", "open")
    .gt("shares_owned", 0);

  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return null;

  const totalShares = rows.reduce((sum, r) => sum + (r.shares_owned ?? 0), 0);
  const withCostBasis = rows.filter(
    (r): r is { shares_owned: number; cost_basis: number } => r.shares_owned != null && r.cost_basis != null
  );
  const weightedShares = withCostBasis.reduce((sum, r) => sum + r.shares_owned, 0);
  const costBasis =
    weightedShares > 0
      ? withCostBasis.reduce((sum, r) => sum + r.cost_basis * r.shares_owned, 0) / weightedShares
      : null;

  return { totalShares, costBasis };
}

async function computeTickerRanking(
  supabase: SupabaseClient<Database>,
  ticker: string,
  targetDte: number,
  callPctAbove: number,
  putPctBelow: number,
  costBasisOverride: number | null
): Promise<RankingTickerResult> {
  const empty = (message: string): RankingTickerResult => ({
    ticker,
    currentPrice: null,
    briefingGeneratedAt: null,
    put: null,
    putError: message,
    call: null,
    callError: message,
  });

  try {
    const group = sectorGroupForTicker(ticker);
    const peerTickers = peerTickersFor(ticker);

    const [chain, closes, spyCloses, peerResults, ivHistory, context, holder] = await Promise.all([
      fetchOptionsChainWithinDays(ticker, chainFetchDays(targetDte)),
      fetchHistoricalCloses(ticker, RELATIVE_STRENGTH_FETCH_DAYS),
      fetchHistoricalCloses("SPY", RELATIVE_STRENGTH_FETCH_DAYS),
      Promise.all(
        peerTickers.map(async (peer): Promise<PeerHistoricals | null> => {
          try {
            return { ticker: peer, closes: await fetchHistoricalCloses(peer, RELATIVE_STRENGTH_FETCH_DAYS) };
          } catch {
            return null;
          }
        })
      ),
      supabase.from("iv_history").select("implied_volatility_avg").eq("ticker", ticker).order("date", { ascending: true }),
      gatherBriefingContext(ticker),
      resolveHolderPosition(supabase, ticker),
    ]);

    const underlyingPrice = chain.underlyingPrice;
    if (underlyingPrice == null || chain.expirations.length === 0) {
      return empty("No live options chain available for this ticker.");
    }

    // Phase 42 -- Ranking reads whatever briefing is already cached
    // (regardless of age) and never triggers a fresh Anthropic
    // generation itself; a cache miss just means the Events component's
    // directional-alignment sub-score scores as absent (0), not opposing.
    // Ticker pages' own Refresh button still generates normally.
    const cachedBriefing = await getCachedBriefingOnly(supabase, ticker);

    const dtes = chain.expirations.map((e) => daysToExpiration(e.expirationDate));
    const frontMonthIndex = findClosestDteIndex(dtes, 37);
    const frontMonth = chain.expirations[frontMonthIndex];
    const frontMonthDte = dtes[frontMonthIndex];

    // Same market-hours-aware effective-IV solving the per-strike scoring
    // below already uses (lib/options-math.ts's effectiveIvAndDelta) --
    // a bare live-bid/ask-only filter here would zero out every contract
    // (and this whole component) whenever the market's closed.
    const toEffectiveIvContract = (contract: CallOrPut, optionType: OptionType) => {
      const { effectiveIv, ivUnreliable } = effectiveIvAndDelta(
        contract,
        optionType,
        underlyingPrice,
        frontMonthDte,
        chain.marketState
      );
      return { strike: contract.strike, impliedVolatility: ivUnreliable ? undefined : effectiveIv ?? undefined };
    };

    const currentIv = atmImpliedVolatility({
      underlyingPrice,
      calls: frontMonth.calls.map((c) => toEffectiveIvContract(c, "call")),
      puts: frontMonth.puts.map((p) => toEffectiveIvContract(p, "put")),
    });

    const historicalValues = (ivHistory.data ?? [])
      .map((r) => r.implied_volatility_avg)
      .filter((v): v is number => typeof v === "number");
    const hvFallback = {
      currentHv: historicalVolatility(closes, 30),
      hvSeries: rollingHistoricalVolatility(closes, 30),
    };

    const peerHistoricals = peerResults.filter((p): p is PeerHistoricals => p != null);
    const relativeStrengthEvaluation: RelativeStrengthEvaluation = evaluateRelativeStrength(
      ticker,
      closes,
      spyCloses,
      group ? peerHistoricals : null
    );

    const availableExpirations: AvailableExpiration[] = chain.expirations.map((e, i) => ({
      expirationDate: e.expirationDate.toISOString().slice(0, 10),
      dte: dtes[i],
    }));

    const scoreSide = (
      direction: TradeDirection,
      pct: number
    ): { score: number; tier: string; strike: number; expirationDate: string; dte: number } | { error: string } => {
      const resolvedExpiration = findNearestExpiration(availableExpirations, targetDte);
      if (!resolvedExpiration) return { error: "No expirations available on this chain." };

      const expirationEntry = chain.expirations[resolvedExpiration.expirationIndex];
      const targetPrice = direction === "put" ? underlyingPrice! * (1 - pct / 100) : underlyingPrice! * (1 + pct / 100);
      const contractList = direction === "call" ? expirationEntry.calls : expirationEntry.puts;
      const strikes = Array.from(new Set(contractList.map((c) => c.strike))).sort((a, b) => a - b);
      const resolvedStrike = findNearestStrike(strikes, targetPrice);
      if (resolvedStrike == null) {
        return { error: `No strike found near $${targetPrice.toFixed(2)} at the ${resolvedExpiration.dte}d expiration.` };
      }

      const contract = contractList.find((c) => c.strike === resolvedStrike)!;
      const { effectiveIv, ivUnreliable } = effectiveIvAndDelta(
        contract,
        direction,
        underlyingPrice!,
        resolvedExpiration.dte,
        chain.marketState
      );

      const toSkewContract = (c: CallOrPut, optionType: OptionType): SkewChainContract => {
        const r = effectiveIvAndDelta(c, optionType, underlyingPrice!, resolvedExpiration.dte, chain.marketState);
        return { delta: r.delta, impliedVolatility: r.effectiveIv };
      };
      const skew: VolatilitySkewResult | null = volatilitySkew({
        calls: expirationEntry.calls.map((c) => toSkewContract(c, "call")),
        puts: expirationEntry.puts.map((p) => toSkewContract(p, "put")),
      });

      const momentumMultiplier = momentumBufferMultiplier(
        direction,
        relativeStrengthEvaluation,
        relativeStrengthEvaluation.structuralTrend
      );
      let cushionScoreValue: number | null = null;
      if (!ivUnreliable && effectiveIv != null) {
        const em = expectedMove(underlyingPrice!, effectiveIv, resolvedExpiration.dte);
        const emCushion = strikeCushion(underlyingPrice!, resolvedStrike, em, direction);
        cushionScoreValue = cushionScore(emCushion, momentumMultiplier);
      }

      const tickerLevel = scoreTickerLevel(
        direction,
        { currentIv, historicalValues, hvFallback },
        {
          lean: cachedBriefing?.content.directionalLean.lean ?? null,
          rationale: cachedBriefing?.content.directionalLean.rationale ?? null,
          daysSinceLastEarnings: context.daysSinceLastEarnings,
          recentHeadlineCount: context.recentHeadlineCount,
        },
        skew,
        { evaluation: relativeStrengthEvaluation, sectorGroupName: group?.name ?? null }
      );

      const combined = combineWithStrikeCushion(tickerLevel.partialTotal, cushionScoreValue);

      return {
        score: combined.total,
        tier: combined.tier,
        strike: resolvedStrike,
        expirationDate: resolvedExpiration.expirationDate,
        dte: resolvedExpiration.dte,
      };
    };

    const putResult = scoreSide("put", putPctBelow);
    const callResult = scoreSide("call", callPctAbove);

    const costBasisMode: "your-position" | "hypothetical" = holder && holder.costBasis != null ? "your-position" : "hypothetical";
    const costBasis = costBasisMode === "your-position" ? holder!.costBasis! : (costBasisOverride ?? underlyingPrice);

    return {
      ticker,
      currentPrice: underlyingPrice,
      briefingGeneratedAt: cachedBriefing?.generatedAt ?? null,
      put: "error" in putResult ? null : putResult,
      putError: "error" in putResult ? putResult.error : null,
      call: "error" in callResult ? null : { ...callResult, costBasis, costBasisMode },
      callError: "error" in callResult ? callResult.error : null,
    };
  } catch (error) {
    // Upstream failures (Anthropic, Finnhub, Yahoo) can surface long,
    // technical, sometimes JSON-shaped error text -- fine in server logs,
    // not fine rendered verbatim in a table cell. Log the real detail,
    // show the user something readable.
    console.error(`Ranking: failed to score ${ticker}:`, error);
    return empty("Couldn't compute a score for this ticker right now (data or service error).");
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetDte = Number(searchParams.get("targetDte") ?? "37");
  const callPctAbove = Number(searchParams.get("callPctAbove") ?? "10");
  const putPctBelow = Number(searchParams.get("putPctBelow") ?? "10");

  if (
    !Number.isFinite(targetDte) ||
    targetDte <= 0 ||
    !Number.isFinite(callPctAbove) ||
    callPctAbove < 0 ||
    !Number.isFinite(putPctBelow) ||
    putPctBelow < 0
  ) {
    return NextResponse.json(
      { error: "targetDte, callPctAbove, and putPctBelow must all be positive numbers" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseRouteClient();
  const { data: watchlist, error: watchlistError } = await supabase.from("watchlist").select("ticker");
  if (watchlistError) {
    return NextResponse.json({ error: watchlistError.message }, { status: 502 });
  }

  const tickers = (watchlist ?? []).map((w) => w.ticker);

  // Per-ticker cost-basis override for the call side's "Hypothetical" mode
  // only -- a ticker with a real tracked position ignores this entirely
  // (see resolveHolderPosition above), matching the existing comparison
  // panel's own "never overridable" contract for a real position.
  const costBasisOverrides = new Map<string, number>();
  for (const ticker of tickers) {
    const raw = searchParams.get(`costBasis_${ticker}`);
    const parsed = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) costBasisOverrides.set(ticker, parsed);
  }

  const results = await mapWithConcurrency(tickers, CONCURRENCY, (ticker) =>
    computeTickerRanking(supabase, ticker, targetDte, callPctAbove, putPctBelow, costBasisOverrides.get(ticker) ?? null)
  );

  return NextResponse.json({
    targetDte,
    callPctAbove,
    putPctBelow,
    results,
    asOf: new Date().toISOString(),
  });
}
