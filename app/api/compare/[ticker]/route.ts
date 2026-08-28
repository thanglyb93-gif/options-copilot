import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { getSupabaseRouteClient } from "@/lib/supabase";
import {
  computeThreeMonthRange,
  daysToExpiration,
  fetchHistoricalCloses,
  fetchOptionsChainWithinDays,
  simpleMovingAverage,
} from "@/lib/yahoo";
import {
  assignmentProbabilityLabel,
  effectiveIvAndDelta,
  probabilityOfTouch,
  referencePremium,
  spreadQuality,
  type OptionType,
} from "@/lib/options-math";
import { cushionScore, expectedMove, strikeCushion } from "@/lib/expected-move";
import {
  operativeResistanceRef,
  operativeSupportRef,
  structuralConfirmation,
  type OperativeReference,
} from "@/lib/structural-levels";
import { volatilitySkew, type SkewChainContract } from "@/lib/volatility";
import { scoreSkewComponent, type TradeDirection } from "@/lib/entry-score";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import {
  describeRelativeStrength,
  evaluateRelativeStrength,
  RELATIVE_STRENGTH_FETCH_DAYS,
  type PeerHistoricals,
} from "@/lib/relative-strength";
import { classifyTrend, describeTrend } from "@/lib/trend";
import {
  annualizedYieldOnCapital,
  capitalRequired,
  classifyDirectionalEdge,
  forwardWorstCase,
} from "@/lib/put-call-comparison";

/**
 * Same 60-day window /api/options fetches for the main Strike Selector
 * -- the mini-selectors this route serves are populated from that exact
 * same data, so a contract available client-side is guaranteed to be
 * findable here too.
 */
const MAX_CHAIN_DAYS = 60;

interface HolderPosition {
  /** Total shares owned across every open position for this ticker with shares_owned > 0. Used to size `contracts` -- the call side can't sell more contracts than the shares actually cover. */
  totalShares: number;
  /** Share-weighted average cost basis across open positions that have both shares_owned > 0 and a known cost_basis. Null only if none of the qualifying positions have a recorded cost basis. */
  costBasis: number | null;
}

/**
 * When a real open position exists, its cost basis is sourced here from
 * the actual tracked position, never accepted as a request parameter
 * (Phase 26) -- this feature's "your position" value depends on that
 * being real, not a guess. When no such position exists, the route
 * falls back to "hypothetical" mode (Phase 27) instead of refusing to
 * run -- see the GET handler below.
 */
async function resolveHolderPosition(
  supabase: ReturnType<typeof getSupabaseRouteClient>,
  ticker: string
): Promise<HolderPosition | null> {
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

interface SideResult {
  strike: number;
  dte: number;
  expirationDate: string;
  premium: number | null;
  capitalRequired: number;
  annualizedYieldOnCapital: number | null;
  assignmentProbability: string | null;
  probabilityOfTouch: string | null;
  emCushion: number | null;
  cushionScore: number | null;
  structuralConfirmation: { confirmed: boolean; referenceLabel: string } | null;
  spreadPct: number | null;
  spreadLabel: "tight" | "moderate" | "wide" | null;
  skewComponent: ReturnType<typeof scoreSkewComponent>;
  worstCaseRealizedGain: number | null;
  upsideForgoneEstimate: number | null;
  worstCaseEffectiveBasis: number | null;
}

function toSkewContracts(
  list: CallOrPut[],
  optionType: OptionType,
  underlyingPrice: number,
  dte: number,
  marketState: string | undefined
): SkewChainContract[] {
  return list.map((c) => {
    const { effectiveIv, delta } = effectiveIvAndDelta(c, optionType, underlyingPrice, dte, marketState);
    return { delta, impliedVolatility: effectiveIv };
  });
}

function evaluateSide({
  direction,
  contract,
  strike,
  dte,
  expirationDateStr,
  underlyingPrice,
  marketState,
  structuralRef,
  allCallsAtExpiration,
  allPutsAtExpiration,
  contracts,
  costBasisIfCall,
}: {
  direction: TradeDirection;
  contract: CallOrPut;
  strike: number;
  dte: number;
  expirationDateStr: string;
  underlyingPrice: number;
  marketState: string | undefined;
  structuralRef: OperativeReference | null;
  allCallsAtExpiration: CallOrPut[];
  allPutsAtExpiration: CallOrPut[];
  contracts: number;
  costBasisIfCall: number | null;
}): SideResult {
  const optionType: OptionType = direction === "call" ? "call" : "put";
  const { effectiveIv, delta, usingLastPriceFallback } = effectiveIvAndDelta(
    contract,
    optionType,
    underlyingPrice,
    dte,
    marketState
  );
  const canComputeGreeks = delta != null && effectiveIv != null;

  const emValue = canComputeGreeks ? expectedMove(underlyingPrice, effectiveIv!, dte) : null;
  const emMultiple = emValue != null ? strikeCushion(underlyingPrice, strike, emValue, direction) : null;
  const cushionScoreValue = emMultiple != null ? cushionScore(emMultiple) : null;

  const premium = referencePremium({
    bid: contract.bid ?? null,
    ask: contract.ask ?? null,
    lastPrice: contract.lastPrice ?? null,
    usingLastPriceFallback,
  });

  const capital = capitalRequired(direction, strike, contracts, contracts * 100);
  const totalPremium = premium != null ? premium * 100 * contracts : null;
  const totalCostBasisIfCall = costBasisIfCall != null ? costBasisIfCall * contracts * 100 : null;
  const yieldOnCapital =
    totalPremium != null
      ? annualizedYieldOnCapital(totalPremium, capital, dte, totalCostBasisIfCall)
      : null;

  const worstCase =
    premium != null
      ? forwardWorstCase(direction, strike, costBasisIfCall, premium, contracts, emValue)
      : { worstCaseRealizedGain: null, upsideForgoneEstimate: null, worstCaseEffectiveBasis: null };

  const spread = spreadQuality(contract.bid ?? 0, contract.ask ?? 0);

  // Skew is a read on the whole expiration (richer put IV vs. richer
  // call IV at the ~25-delta points), not something that differs
  // depending on which side of this comparison is being evaluated --
  // both sides at the same expiration would see the same skew reading.
  const skew = volatilitySkew({
    calls: toSkewContracts(allCallsAtExpiration, "call", underlyingPrice, dte, marketState),
    puts: toSkewContracts(allPutsAtExpiration, "put", underlyingPrice, dte, marketState),
  });
  const skewComponent = scoreSkewComponent(direction, skew);

  return {
    strike,
    dte,
    expirationDate: expirationDateStr,
    premium,
    capitalRequired: capital,
    annualizedYieldOnCapital: yieldOnCapital,
    assignmentProbability: delta != null ? assignmentProbabilityLabel(delta) : null,
    probabilityOfTouch: delta != null ? `~${Math.round(probabilityOfTouch(delta) * 100)}%` : null,
    emCushion: emMultiple,
    cushionScore: cushionScoreValue,
    structuralConfirmation: structuralRef ? structuralConfirmation(strike, structuralRef, direction) : null,
    spreadPct: spread?.spreadPct ?? null,
    spreadLabel: spread?.label ?? null,
    skewComponent,
    worstCaseRealizedGain: worstCase.worstCaseRealizedGain,
    upsideForgoneEstimate: worstCase.upsideForgoneEstimate,
    worstCaseEffectiveBasis: worstCase.worstCaseEffectiveBasis,
  };
}

export async function GET(request: Request, { params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  const { searchParams } = new URL(request.url);

  const putStrike = Number(searchParams.get("putStrike"));
  const putExpiration = searchParams.get("putExpiration");
  const callStrike = Number(searchParams.get("callStrike"));
  const callExpiration = searchParams.get("callExpiration");
  // Hypothetical mode only -- ignored entirely when a real position
  // exists (see mode resolution below). Optional: when absent, defaults
  // to underlyingPrice once the chain's been fetched.
  const hypotheticalCostBasisParam = searchParams.get("hypotheticalCostBasis");

  if (!putExpiration || !callExpiration || !Number.isFinite(putStrike) || !Number.isFinite(callStrike)) {
    return NextResponse.json(
      { error: "putStrike, putExpiration, callStrike, callExpiration are all required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseRouteClient();

  try {
    const holder = await resolveHolderPosition(supabase, ticker);

    const group = sectorGroupForTicker(ticker);
    const peerTickers = peerTickersFor(ticker);

    const [chain, closes, spyCloses, peerResults] = await Promise.all([
      fetchOptionsChainWithinDays(ticker, MAX_CHAIN_DAYS),
      fetchHistoricalCloses(ticker, RELATIVE_STRENGTH_FETCH_DAYS),
      fetchHistoricalCloses("SPY", RELATIVE_STRENGTH_FETCH_DAYS),
      Promise.all(
        peerTickers.map(async (peerTicker): Promise<PeerHistoricals | null> => {
          try {
            const peerCloses = await fetchHistoricalCloses(peerTicker, RELATIVE_STRENGTH_FETCH_DAYS);
            return { ticker: peerTicker, closes: peerCloses };
          } catch {
            return null;
          }
        })
      ),
    ]);

    const underlyingPrice = chain.underlyingPrice;
    if (underlyingPrice == null) {
      return NextResponse.json({ error: "No live price available for this ticker" }, { status: 502 });
    }

    // --- Mode resolution (Phase 27) ---
    // A real position (with a recorded cost basis) always wins --
    // "your position" mode is never overridable by a client-supplied
    // cost basis. Only when no such position exists does the route fall
    // back to "hypothetical": a made-up share count (one contract's
    // worth) and a cost basis that's either client-supplied (the
    // editable field) or defaults to today's live price.
    const mode: "your-position" | "hypothetical" = holder && holder.costBasis != null ? "your-position" : "hypothetical";
    const sharesOwned = mode === "your-position" ? holder!.totalShares : 100;
    const costBasis =
      mode === "your-position"
        ? holder!.costBasis!
        : (() => {
            const parsed = hypotheticalCostBasisParam != null ? Number(hypotheticalCostBasisParam) : NaN;
            return Number.isFinite(parsed) && parsed > 0 ? parsed : underlyingPrice;
          })();

    const putExpirationEntry = chain.expirations.find(
      (e) => e.expirationDate.toISOString().slice(0, 10) === putExpiration
    );
    const callExpirationEntry = chain.expirations.find(
      (e) => e.expirationDate.toISOString().slice(0, 10) === callExpiration
    );
    if (!putExpirationEntry || !callExpirationEntry) {
      return NextResponse.json(
        { error: "Selected expiration not found in the current chain (it may have expired or rolled off the 60-day window)" },
        { status: 400 }
      );
    }

    const putContract = putExpirationEntry.puts.find((p) => p.strike === putStrike);
    const callContract = callExpirationEntry.calls.find((c) => c.strike === callStrike);
    if (!putContract || !callContract) {
      return NextResponse.json({ error: "Selected strike not found for that expiration" }, { status: 400 });
    }

    const putDte = daysToExpiration(putExpirationEntry.expirationDate);
    const callDte = daysToExpiration(callExpirationEntry.expirationDate);

    // Same contracts count on both sides -- shares actually owned (or,
    // in hypothetical mode, the default share count) cap the call side,
    // and using that same size on the put side keeps this a genuine
    // apples-to-apples comparison rather than two arbitrary sizes.
    const contracts = Math.max(1, Math.floor(sharesOwned / 100));

    // --- Ticker-level context, computed once ---
    const sma20 = simpleMovingAverage(closes, 20);
    const sma50 = simpleMovingAverage(closes, 50);
    const sma200 = simpleMovingAverage(closes, 200);
    const ninetyDayRange = computeThreeMonthRange(closes);
    const supportRef = operativeSupportRef(underlyingPrice, sma50, ninetyDayRange?.low ?? null);
    const resistanceRef = operativeResistanceRef(underlyingPrice, sma50, ninetyDayRange?.high ?? null);

    const trend = classifyTrend({ price: underlyingPrice, sma20, sma50, sma200 });
    const trendDescription = describeTrend({ price: underlyingPrice, sma20, sma50, sma200 });

    const peerHistoricals = peerResults.filter((p): p is PeerHistoricals => p != null);
    const relativeStrengthEvaluation = evaluateRelativeStrength(
      ticker,
      closes,
      spyCloses,
      group ? peerHistoricals : null
    );
    const relativeStrengthSummary = describeRelativeStrength(relativeStrengthEvaluation, group?.name ?? null);
    const directionalEdge = classifyDirectionalEdge(relativeStrengthEvaluation.suitability);

    // --- Per-side ---
    const putSide = evaluateSide({
      direction: "put",
      contract: putContract,
      strike: putStrike,
      dte: putDte,
      expirationDateStr: putExpiration,
      underlyingPrice,
      marketState: chain.marketState,
      structuralRef: supportRef,
      allCallsAtExpiration: putExpirationEntry.calls,
      allPutsAtExpiration: putExpirationEntry.puts,
      contracts,
      costBasisIfCall: null,
    });

    const callSide = evaluateSide({
      direction: "call",
      contract: callContract,
      strike: callStrike,
      dte: callDte,
      expirationDateStr: callExpiration,
      underlyingPrice,
      marketState: chain.marketState,
      structuralRef: resistanceRef,
      allCallsAtExpiration: callExpirationEntry.calls,
      allPutsAtExpiration: callExpirationEntry.puts,
      contracts,
      costBasisIfCall: costBasis,
    });

    return NextResponse.json({
      ticker,
      mode,
      underlyingPrice,
      costBasis,
      sharesOwned,
      contracts,
      putSide,
      callSide,
      trend,
      trendDescription,
      relativeStrengthSummary,
      directionalEdge,
      ninetyDayRange,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
