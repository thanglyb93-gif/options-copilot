/**
 * Shared trading-day (array-index) distance helpers -- Phase 33 uses these
 * across Parts A, B, D and E instead of a calendar-day estimate, which
 * would be thrown off by weekends/holidays. Same index-counting
 * convention lib/flags.ts's earningsCooldownFlag and lib/event-timeline.ts
 * already use, just factored out since multiple new modules need it.
 */

import type { DailyClose } from "./yahoo";

/** Index of the last entry at or before `date` -- -1 if `date` is before every entry in `closes`. */
export function indexAtOrBefore(closes: DailyClose[], date: string): number {
  let idx = -1;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i].date <= date) idx = i;
    else break;
  }
  return idx;
}

/**
 * Real trading days elapsed between `fromDate` and the last entry in
 * `closes` (or `toDate` when given), counted by array position. Null when
 * `fromDate` (or `toDate`) isn't covered by `closes`.
 */
export function tradingDaysElapsed(closes: DailyClose[], fromDate: string, toDate?: string): number | null {
  const fromIndex = indexAtOrBefore(closes, fromDate);
  if (fromIndex === -1) return null;
  const toIndex = toDate ? indexAtOrBefore(closes, toDate) : closes.length - 1;
  if (toIndex === -1) return null;
  return toIndex - fromIndex;
}
