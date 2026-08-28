/**
 * Max pain: the strike at which option holders (in aggregate) lose the
 * most money at expiration -- equivalently, where total payout to holders
 * is minimized. No API/DB calls -- unit-testable in isolation.
 */

export interface StrikeOpenInterest {
  strike: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

/**
 * Computes total dollar payout to option holders if the underlying settles
 * at `settlementPrice`, given open interest across all strikes.
 */
export function totalPayoutAt(
  settlementPrice: number,
  rows: StrikeOpenInterest[]
): number {
  let payout = 0;
  for (const row of rows) {
    if (row.strike < settlementPrice) {
      // ITM calls
      payout += (settlementPrice - row.strike) * row.callOpenInterest;
    } else if (row.strike > settlementPrice) {
      // ITM puts
      payout += (row.strike - settlementPrice) * row.putOpenInterest;
    }
  }
  return payout;
}

/** Returns the strike that minimizes aggregate option-holder payout. */
export function calculateMaxPain(rows: StrikeOpenInterest[]): number | null {
  if (rows.length === 0) return null;

  let maxPainStrike = rows[0].strike;
  let minPayout = Infinity;

  for (const candidate of rows) {
    const payout = totalPayoutAt(candidate.strike, rows);
    if (payout < minPayout) {
      minPayout = payout;
      maxPainStrike = candidate.strike;
    }
  }

  return maxPainStrike;
}

/** Aggregates a chain's calls/puts into per-strike open interest, sorted by strike. */
export function buildStrikeRows(
  calls: { strike: number; openInterest?: number }[],
  puts: { strike: number; openInterest?: number }[]
): StrikeOpenInterest[] {
  const byStrike = new Map<number, StrikeOpenInterest>();

  for (const call of calls) {
    const row = byStrike.get(call.strike) ?? {
      strike: call.strike,
      callOpenInterest: 0,
      putOpenInterest: 0,
    };
    row.callOpenInterest += call.openInterest ?? 0;
    byStrike.set(call.strike, row);
  }

  for (const put of puts) {
    const row = byStrike.get(put.strike) ?? {
      strike: put.strike,
      callOpenInterest: 0,
      putOpenInterest: 0,
    };
    row.putOpenInterest += put.openInterest ?? 0;
    byStrike.set(put.strike, row);
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

/**
 * Put/Call open-interest ratio across a chain's strikes: total put OI /
 * total call OI. A widely-used sentiment gauge -- above 1 skews toward
 * put positioning (hedging/bearish lean), below 1 toward calls. Null
 * when there's no call open interest to divide by (can't compute a
 * meaningful ratio, not a fabricated 0).
 */
export function putCallRatio(rows: StrikeOpenInterest[]): number | null {
  const totalCallOi = rows.reduce((sum, r) => sum + r.callOpenInterest, 0);
  const totalPutOi = rows.reduce((sum, r) => sum + r.putOpenInterest, 0);
  if (totalCallOi <= 0) return null;
  return totalPutOi / totalCallOi;
}
