/**
 * Detects gaps in a ticker's daily iv_history collection: weekdays since
 * it was added to the watchlist with no successful snapshot row. Today is
 * included once the daily cron's scheduled time has passed (see
 * vercel.json), so a same-day collection failure shows up immediately
 * rather than waiting for tomorrow's check to notice a hole -- this is
 * also how "the most recent cron run logged a failure" gets folded into
 * the same gap check instead of needing a separate run-log table. Pure --
 * no I/O; callers gather the watchlist + iv_history rows.
 */

export interface IvHistoryRowLike {
  date: string; // ISO date (YYYY-MM-DD)
  implied_volatility_avg: number | null;
  trailing_30d_hv: number | null;
}

export interface TickerGap {
  ticker: string;
  missingDates: string[];
  expectedCount: number;
  collectedCount: number;
}

// vercel.json schedules the snapshot cron at 21:00 UTC. Give it an hour
// of buffer before expecting today's row to exist, so a health check
// earlier in the day doesn't falsely flag "today" as a gap before the
// cron has even had a chance to run.
const CRON_HOUR_UTC = 21;
const CRON_BUFFER_HOURS = 1;

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Weekdays (UTC) from `startIso` through `endIso`, inclusive. */
function weekdaysBetween(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cursor <= end) {
    if (isWeekday(cursor)) days.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Returns the gap for one ticker, or null if fully collected. A row
 * counts as collected if it exists AND has at least one non-null value
 * (implied_volatility_avg or trailing_30d_hv) -- a row that exists but is
 * fully null means the snapshot ran that day but produced nothing usable
 * (e.g. no underlying price), which is exactly the kind of silent
 * breakage this is meant to catch.
 *
 * `collectionStartDate` (if given) floors the expected-date range at the
 * earliest date snapshot collection is known to have ever succeeded
 * anywhere -- a ticker added to the watchlist before that (e.g. via local
 * dev against the same database, before the app's first production
 * deployment, when the cron couldn't possibly have run yet) isn't blamed
 * for days collection could never have covered. Self-updating: derived
 * from the data itself, not a hardcoded deploy date.
 */
export function detectTickerGap(
  ticker: string,
  addedAt: string,
  rows: IvHistoryRowLike[],
  now: Date = new Date(),
  collectionStartDate: string | null = null
): TickerGap | null {
  const today = toIsoDate(now);
  const cutoffPassed = now.getUTCHours() >= CRON_HOUR_UTC + CRON_BUFFER_HOURS;
  const yesterday = toIsoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const through = cutoffPassed ? today : yesterday;

  const addedDate = addedAt.slice(0, 10);
  const floorDate =
    collectionStartDate && collectionStartDate > addedDate ? collectionStartDate : addedDate;
  if (floorDate > through) return null; // added after the window being checked

  const expectedDates = weekdaysBetween(floorDate, through);
  if (expectedDates.length === 0) return null;

  const rowsByDate = new Map(rows.map((r) => [r.date, r]));
  const missingDates = expectedDates.filter((d) => {
    const row = rowsByDate.get(d);
    if (!row) return true;
    return row.implied_volatility_avg == null && row.trailing_30d_hv == null;
  });

  if (missingDates.length === 0) return null;

  return {
    ticker,
    missingDates,
    expectedCount: expectedDates.length,
    collectedCount: expectedDates.length - missingDates.length,
  };
}
