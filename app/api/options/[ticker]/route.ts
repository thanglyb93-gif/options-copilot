import { NextResponse } from "next/server";
import type { CallOrPut } from "yahoo-finance2/modules/options";
import { fetchOptionsChainWithinDays, daysToExpiration } from "@/lib/yahoo";
import {
  blackScholesDelta,
  blackScholesTheta,
  findClosestDteIndex,
  type OptionType,
} from "@/lib/options-math";
import { deltaBandFlag, dteBandFlag, unreliableIvFlag } from "@/lib/flags";
import { atmImpliedVolatility } from "@/lib/volatility";

const MAX_DAYS = 60;

function mapContract(
  contract: CallOrPut,
  optionType: OptionType,
  underlyingPrice: number | undefined,
  dte: number
) {
  const ivUnreliable = unreliableIvFlag(contract);

  const canComputeGreeks =
    !ivUnreliable && underlyingPrice != null && contract.impliedVolatility != null;

  const greeksInput = canComputeGreeks
    ? {
        spot: underlyingPrice!,
        strike: contract.strike,
        dte,
        volatility: contract.impliedVolatility,
        optionType,
      }
    : null;

  const delta = greeksInput ? blackScholesDelta(greeksInput) : null;
  const theta = greeksInput ? blackScholesTheta(greeksInput) : null;

  return {
    contractSymbol: contract.contractSymbol,
    strike: contract.strike,
    bid: contract.bid ?? null,
    ask: contract.ask ?? null,
    volume: contract.volume ?? null,
    openInterest: contract.openInterest ?? null,
    impliedVolatility: contract.impliedVolatility ?? null,
    ivUnreliable,
    delta,
    theta,
    inTargetBand:
      delta != null && deltaBandFlag(delta) && dteBandFlag(dte),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  try {
    const chain = await fetchOptionsChainWithinDays(ticker, MAX_DAYS);

    const expirations = chain.expirations.map((expiration) => {
      const dte = daysToExpiration(expiration.expirationDate);
      return {
        expirationDate: expiration.expirationDate.toISOString().slice(0, 10),
        dte,
        calls: expiration.calls.map((c) =>
          mapContract(c, "call", chain.underlyingPrice, dte)
        ),
        puts: expiration.puts.map((p) =>
          mapContract(p, "put", chain.underlyingPrice, dte)
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
