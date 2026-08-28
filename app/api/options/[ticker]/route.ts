import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import {
  fetchOptionsChainWithinDays,
  fetchTargetExpirationChain,
  fetchHistoricalCloses,
  simpleMovingAverage,
  computeThreeMonthRange,
  daysToExpiration,
} from "@/lib/yahoo";
import {
  blackScholesTheta,
  effectiveIvAndDelta,
  findClosestDteIndex,
  assignmentProbabilityLabel,
  probabilityOfTouch,
  spreadQuality,
  type OptionType,
} from "@/lib/options-math";
import { deltaBandFlag, dteBandFlag, unreliableIvFlag } from "@/lib/flags";
import { atmImpliedVolatility, ivTermStructure, volatilitySkew } from "@/lib/volatility";
import { expectedMove, strikeCushion, cushionScore } from "@/lib/expected-move";
import {
  operativeSupportRef,
  operativeResistanceRef,
  structuralConfirmation,
  type OperativeReference,
} from "@/lib/structural-levels";

const MAX_DAYS = 60;

// IV term-structure comparison targets a far-month expiration in this
// DTE band -- a separate, single-expiration fetch (not an expansion of
// MAX_DAYS above, which would also grow the Strike Selector's available
// expirations, a UI change nobody asked for here).
const FAR_TERM_MIN_DTE = 60;
const FAR_TERM_MAX_DTE = 90;
const FAR_TERM_TARGET_DTE = 75; // midpoint

function mapContract(
  contract: CallOrPut,
  optionType: OptionType,
  underlyingPrice: number | undefined,
  dte: number,
  operativeRef: OperativeReference | null,
  marketState: string | undefined
) {
  const { effectiveIv, ivUnreliable, usingLastPriceFallback, delta } = effectiveIvAndDelta(
    contract,
    optionType,
    underlyingPrice,
    dte,
    marketState
  );

  const canComputeGreeks = !ivUnreliable && underlyingPrice != null && effectiveIv != null;

  const theta = canComputeGreeks
    ? blackScholesTheta({ spot: underlyingPrice!, strike: contract.strike, dte, volatility: effectiveIv!, optionType })
    : null;

  let emCushion: number | null = null;
  let cushionScoreValue: number | null = null;
  if (canComputeGreeks) {
    const em = expectedMove(underlyingPrice!, effectiveIv!, dte);
    emCushion = strikeCushion(underlyingPrice!, contract.strike, em, optionType);
    cushionScoreValue = cushionScore(emCushion);
  }

  const touchProbability = delta != null ? probabilityOfTouch(delta) : null;
  // Only ever computed from a genuinely live two-sided market -- never
  // from the lastPrice fallback (spreadQuality itself also guards this,
  // but bid/ask are literally absent/zero in that state anyway).
  const spread = spreadQuality(contract.bid ?? 0, contract.ask ?? 0);

  return {
    contractSymbol: contract.contractSymbol,
    strike: contract.strike,
    bid: contract.bid ?? null,
    ask: contract.ask ?? null,
    lastPrice: contract.lastPrice ?? null,
    volume: contract.volume ?? null,
    openInterest: contract.openInterest ?? null,
    impliedVolatility: effectiveIv,
    ivUnreliable,
    usingLastPriceFallback,
    delta,
    theta,
    inTargetBand:
      delta != null && deltaBandFlag(delta) && dteBandFlag(dte),
    assignmentProbability: delta != null ? assignmentProbabilityLabel(delta) : null,
    probabilityOfTouch: touchProbability != null ? `~${Math.round(touchProbability * 100)}%` : null,
    spreadPct: spread?.spreadPct ?? null,
    spreadLabel: spread?.label ?? null,
    emCushion,
    cushionScore: cushionScoreValue,
    structuralConfirmation: operativeRef
      ? structuralConfirmation(contract.strike, operativeRef, optionType)
      : null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  try {
    const [chain, closes, farChain] = await Promise.all([
      fetchOptionsChainWithinDays(ticker, MAX_DAYS),
      fetchHistoricalCloses(ticker, 300),
      fetchTargetExpirationChain(ticker, FAR_TERM_TARGET_DTE).catch(() => null),
    ]);

    const sma50 = simpleMovingAverage(closes, 50);
    const ninetyDayRange = computeThreeMonthRange(closes);

    // Structural reference is a ticker-level constant (same for every
    // strike within a direction) -- computed once, applied per-row below.
    const supportRef =
      chain.underlyingPrice != null
        ? operativeSupportRef(chain.underlyingPrice, sma50, ninetyDayRange?.low ?? null)
        : null;
    const resistanceRef =
      chain.underlyingPrice != null
        ? operativeResistanceRef(chain.underlyingPrice, sma50, ninetyDayRange?.high ?? null)
        : null;

    const expirations = chain.expirations.map((expiration) => {
      const dte = daysToExpiration(expiration.expirationDate);
      return {
        expirationDate: expiration.expirationDate.toISOString().slice(0, 10),
        dte,
        calls: expiration.calls.map((c) =>
          mapContract(c, "call", chain.underlyingPrice, dte, resistanceRef, chain.marketState)
        ),
        puts: expiration.puts.map((p) =>
          mapContract(p, "put", chain.underlyingPrice, dte, supportRef, chain.marketState)
        ),
      };
    });

    // "Front month" for the volatility panel targets the 30-45 DTE band
    // this app screens for, not literally the nearest calendar
    // expiration -- the nearest weekly is frequently a dead contract with
    // no real market (see unreliableIvFlag).
    const targetIndex = findClosestDteIndex(
      chain.expirations.map((e) => daysToExpiration(e.expirationDate))
    );
    const frontMonth = chain.expirations[targetIndex];
    const frontMonthAtmIv =
      frontMonth && chain.underlyingPrice != null
        ? atmImpliedVolatility({
            underlyingPrice: chain.underlyingPrice,
            calls: frontMonth.calls.filter((c) => !unreliableIvFlag(c)),
            puts: frontMonth.puts.filter((p) => !unreliableIvFlag(p)),
          })
        : null;

    // Graceful degradation: only compute a far-month IV (and therefore a
    // term structure) when the chain actually has an expiration that
    // truly falls within the 60-90 DTE band -- "closest to 75 DTE" can
    // otherwise return something well outside that band for a ticker
    // with a limited/short-dated chain, which would be a misleading
    // comparison rather than a real term-structure read.
    const farDte = farChain ? daysToExpiration(farChain.expirationDate) : null;
    const farInBand = farDte != null && farDte >= FAR_TERM_MIN_DTE && farDte <= FAR_TERM_MAX_DTE;
    const farMonthAtmIv =
      farChain && farInBand && chain.underlyingPrice != null
        ? atmImpliedVolatility({
            underlyingPrice: chain.underlyingPrice,
            calls: farChain.calls.filter((c) => !unreliableIvFlag(c)),
            puts: farChain.puts.filter((p) => !unreliableIvFlag(p)),
          })
        : null;

    const termStructure =
      frontMonthAtmIv != null && farMonthAtmIv != null && farMonthAtmIv > 0
        ? ivTermStructure(frontMonthAtmIv, farMonthAtmIv)
        : null;

    // Uses the already-mapped front-month row (expirations[targetIndex]),
    // not the raw `frontMonth` chain above -- volatilitySkew needs each
    // contract's computed delta, which only exists after mapContract().
    const frontMonthMapped = expirations[targetIndex];
    const skew = frontMonthMapped
      ? volatilitySkew({ calls: frontMonthMapped.calls, puts: frontMonthMapped.puts })
      : null;

    return NextResponse.json({
      ticker,
      underlyingPrice: chain.underlyingPrice ?? null,
      marketState: chain.marketState ?? null,
      frontMonthAtmIv,
      termStructure,
      volatilitySkew: skew,
      defaultExpirationIndex: targetIndex,
      expirations,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}
