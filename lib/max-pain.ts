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
