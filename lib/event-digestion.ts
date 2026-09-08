/**
 * Phase 33 Part D -- event digestion status. Answers "how far has this
 * ticker's volatility percentile moved back toward its own trailing
 * baseline since the event/move," never "what happens next." Reuses IV
 * Percentile (lib/entry-score.ts's IV_HISTORY_MIN_ROWS maturity gate,
 * without modifying that file) when enough real iv_history existed as of
 * the event date, HV Percentile otherwise -- HV can always be computed
 * retroactively from price history alone, which is normally the only
 * option for anything but a very recently-tracked ticker at a past date.
 */

import type { DailyClose } from "./yahoo";
import { hvPercentileRank, percentileRank } from "./volatility";
import { IV_HISTORY_MIN_ROWS } from "./entry-score";
import { formatOrdinal } from "./format";
import { indexAtOrBefore, tradingDaysElapsed } from "./trading-days";

/** Conservative default "typical trading days to stabilize" when Part E has insufficient ticker-specific history. */
export const DEFAULT_STABILIZATION_TRADING_DAYS = 5;

export interface EventDigestionStatus {
  metricLabel: "IV Percentile" | "HV Percentile";
  currentPercentile: number;
  eventPeakPercentile: number;
  tradingDaysElapsed: number;
  typicalTradingDays: number;
  usedDefaultTypical: boolean;
}

/**
 * `ivHistory` is this ticker's real iv_history rows (date + IV), already
 * fetched by the caller -- never re-queried here. `currentIv` is today's
 * front-month ATM IV, also already computed by the caller. Returns null
 * when there isn't enough data to say anything, rather than a fabricated
 * percentile.
 */
export function computeEventDigestionStatus(
  eventDate: string,
  closes: DailyClose[],
  ivHistory: { date: string; iv: number }[],
  currentIv: number | null,
  typicalTradingDaysHint: number | null
): EventDigestionStatus | null {
  const eventIndex = indexAtOrBefore(closes, eventDate);
  if (eventIndex === -1) return null;
  const daysElapsed = tradingDaysElapsed(closes, eventDate);
  if (daysElapsed == null) return null;

  const typicalTradingDays = typicalTradingDaysHint ?? DEFAULT_STABILIZATION_TRADING_DAYS;
  const usedDefaultTypical = typicalTradingDaysHint == null;

  const ivAsOfEvent = ivHistory.filter((r) => r.date <= eventDate).map((r) => r.iv);
  const ivAtEventDate = ivHistory.find((r) => r.date === eventDate)?.iv ?? null;

  if (ivAsOfEvent.length >= IV_HISTORY_MIN_ROWS && ivAtEventDate != null && currentIv != null) {
    const eventPeakPercentile = percentileRank(ivAtEventDate, ivAsOfEvent);
    const currentPercentile = percentileRank(currentIv, ivHistory.map((r) => r.iv));
    if (eventPeakPercentile != null && currentPercentile != null) {
      return {
        metricLabel: "IV Percentile",
        currentPercentile,
        eventPeakPercentile,
        tradingDaysElapsed: daysElapsed,
        typicalTradingDays,
        usedDefaultTypical,
      };
    }
  }

  // HV fallback -- computable purely from price history at any past date.
  const eventPeak = hvPercentileRank(closes.slice(0, eventIndex + 1));
  const current = hvPercentileRank(closes);
  if (eventPeak.percentile == null || current.percentile == null) return null;

  return {
    metricLabel: "HV Percentile",
    currentPercentile: current.percentile,
    eventPeakPercentile: eventPeak.percentile,
    tradingDaysElapsed: daysElapsed,
    typicalTradingDays,
    usedDefaultTypical,
  };
}

export function describeEventDigestionStatus(status: EventDigestionStatus): string {
  return (
    `${status.metricLabel}: ${formatOrdinal(status.currentPercentile)} today vs ${formatOrdinal(status.eventPeakPercentile)} at event peak, ` +
    `${status.tradingDaysElapsed} of ${status.typicalTradingDays}${status.usedDefaultTypical ? " (default)" : ""} typical trading days elapsed.`
  );
}
