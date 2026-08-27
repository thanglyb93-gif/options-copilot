import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import {
  fetchOptionsChainWithinDays,
  fetchHistoricalCloses,
  simpleMovingAverage,
  computeThreeMonthRange,
  daysToExpiration,
} from "@/lib/yahoo";
import {
  blackScholesDelta,
  blackScholesTheta,
  findClosestDteIndex,
  assignmentProbabilityLabel,
  impliedVolatilityFromPrice,
  type OptionType,
} from "@/lib/options-math";
import { assessContractReliability, deltaBandFlag, dteBandFlag, unreliableIvFlag } from "@/lib/flags";
import { atmImpliedVolatility } from "@/lib/volatility";
import { expectedMove, strikeCushion, cushionScore } from "@/lib/expected-move";
import {
  operativeSupportRef,
  operativeResistanceRef,
  structuralConfirmation,
  type OperativeReference,
} from "@/lib/structural-levels";

const MAX_DAYS = 60;

function mapContract(
  contract: CallOrPut,
  optionType: OptionType,
  underlyingPrice: number | undefined,
  dte: number,
  operativeRef: OperativeReference | null,
  marketState: string | undefined
) {
  const reliability = assessContractReliability(contract, marketState);
  let ivUnreliable = reliability.unreliable;
  let usingLastPriceFallback = reliability.usingLastPriceFallback;
  let effectiveIv = contract.impliedVolatility ?? null;

  if (usingLastPriceFallback && underlyingPrice != null && contract.lastPrice != null) {
    // Yahoo's own impliedVolatility field is frequently a degenerate
    // placeholder (e.g. ~0.00001) when there's no live bid/ask, which
    // would otherwise produce nonsense Greeks (delta pinned to 1, etc).
    // Solve for the volatility that actually reproduces lastPrice instead.
    const solvedIv = impliedVolatilityFromPrice({
      spot: underlyingPrice,
      strike: contract.strike,
      dte,
      targetPrice: contract.lastPrice,
      optionType,
    });
    if (solvedIv != null) {
      effectiveIv = solvedIv;
    } else {
      // lastPrice can't be reconciled with any plausible volatility (e.g.
      // stale from before a large move) -- no estimate would be honest.
      ivUnreliable = true;
      usingLastPriceFallback = false;
    }
  }

  const canComputeGreeks = !ivUnreliable && underlyingPrice != null && effectiveIv != null;

  const greeksInput = canComputeGreeks
    ? {
        spot: underlyingPrice!,
        strike: contract.strike,
        dte,
        volatility: effectiveIv!,
        optionType,
      }
    : null;

  const delta = greeksInput ? blackScholesDelta(greeksInput) : null;
  const theta = greeksInput ? blackScholesTheta(greeksInput) : null;

  let emCushion: number | null = null;
  let cushionScoreValue: number | null = null;
  if (canComputeGreeks) {
    const em = expectedMove(underlyingPrice!, effectiveIv!, dte);
    emCushion = strikeCushion(underlyingPrice!, contract.strike, em, optionType);
    cushionScoreValue = cushionScore(emCushion);
  }

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
    const [chain, closes] = await Promise.all([
      fetchOptionsChainWithinDays(ticker, MAX_DAYS),
      fetchHistoricalCloses(ticker, 300),
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

    return NextResponse.json({
      ticker,
      underlyingPrice: chain.underlyingPrice ?? null,
      marketState: chain.marketState ?? null,
      frontMonthAtmIv,
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
