/**
 * Phase 41 -- strike/expiration targeting helpers for the Ranking page:
 * given a ticker's own actual chain (which never lines up exactly with
 * another ticker's expiration dates or strike ladder), resolve whichever
 * real expiration/strike is closest to a user-chosen target. Pure -- no
 * API/DB calls; callers gather the raw chain data. Reuses
 * lib/options-math.ts's findClosestDteIndex directly rather than a
 * second nearest-DTE search.
 */

import { findClosestDteIndex } from "./options-math";

export interface AvailableExpiration {
  expirationDate: string; // ISO "YYYY-MM-DD"
  dte: number;
}

export interface ResolvedExpiration {
  expirationIndex: number;
  expirationDate: string;
  /** The actual DTE this expiration represents -- shown for transparency, since different tickers can resolve to a different actual DTE for the same target. */
  dte: number;
}

/** Closest available expiration to `targetDte`, or null if the ticker has none listed at all. */
export function findNearestExpiration(
  availableExpirations: readonly AvailableExpiration[],
  targetDte: number
): ResolvedExpiration | null {
  if (availableExpirations.length === 0) return null;
  const expirationIndex = findClosestDteIndex(
    availableExpirations.map((e) => e.dte),
    targetDte
  );
  const chosen = availableExpirations[expirationIndex];
  return { expirationIndex, expirationDate: chosen.expirationDate, dte: chosen.dte };
}

/**
 * A "nearest" match more than this far from the target price (as a
 * fraction of it) is treated as no real match at all -- a thin or
 * gappy chain picking something wildly off-target would be more
 * misleading than admitting nothing usable was found nearby. Adjustable.
 */
export const MAX_STRIKE_DISTANCE_PCT = 20;

/**
 * Closest listed strike to `targetPrice` among `availableStrikes` (this
 * expiration's actual strike ladder) -- null if the chain has no
 * strikes at all, or the closest one is further than
 * MAX_STRIKE_DISTANCE_PCT away from the target.
 */
export function findNearestStrike(availableStrikes: readonly number[], targetPrice: number): number | null {
  if (availableStrikes.length === 0) return null;

  let best = availableStrikes[0];
  let bestDiff = Math.abs(best - targetPrice);
  for (const strike of availableStrikes) {
    const diff = Math.abs(strike - targetPrice);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = strike;
    }
  }

  if (targetPrice > 0 && (bestDiff / targetPrice) * 100 > MAX_STRIKE_DISTANCE_PCT) return null;
  return best;
}

/** Bounds concurrent per-ticker work so a large watchlist doesn't fire 20+ simultaneous requests at once -- shared by /api/ranking and /api/ranking/expirations. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}
