/**
 * Phase 33 Part E -- this ticker's own historical stabilization pattern.
 * Walks forward from each of the ticker's past significant-move events
 * (Phase 32's event_annotations cache -- never re-detected here) day by
 * day, measuring how many trading days realized volatility took to settle
 * back within a defined band of its pre-event baseline. Always reports
 * sample size alongside the median -- n < 3 is explicitly labeled
 * insufficient rather than presented as a reliable figure.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchHistoricalCloses, type DailyClose } from "./yahoo";
import { historicalVolatility } from "./volatility";
import { indexAtOrBefore } from "./trading-days";
import {
  STABILIZATION_BAND_PCT,
  STABILIZATION_VOL_WINDOW,
  MAX_STABILIZATION_LOOKAHEAD_TRADING_DAYS,
  STABILIZATION_MIN_SAMPLE_SIZE,
  STABILIZATION_HISTORY_FETCH_DAYS,
} from "./timing-constants";

export interface StabilizationPattern {
  medianTradingDays: number | null;
  sampleSize: number;
  insufficientHistory: boolean;
}

function daysToStabilize(closes: DailyClose[], eventIndex: number): number | null {
  if (eventIndex < STABILIZATION_VOL_WINDOW) return null; // not enough pre-event history for a baseline
  const baseline = historicalVolatility(closes.slice(0, eventIndex + 1), STABILIZATION_VOL_WINDOW);
  if (baseline == null || baseline <= 0) return null;

  const lastIndex = Math.min(closes.length - 1, eventIndex + MAX_STABILIZATION_LOOKAHEAD_TRADING_DAYS);
  for (let i = eventIndex + 1; i <= lastIndex; i++) {
    const vol = historicalVolatility(closes.slice(0, i + 1), STABILIZATION_VOL_WINDOW);
    if (vol == null) continue;
    const deviationPct = (Math.abs(vol - baseline) / baseline) * 100;
    if (deviationPct <= STABILIZATION_BAND_PCT) return i - eventIndex;
  }
  return null; // never came back within band inside the lookahead cap
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function computeStabilizationPattern(
  supabase: SupabaseClient<Database>,
  ticker: string
): Promise<StabilizationPattern> {
  const { data: moveRows, error } = await supabase
    .from("event_annotations")
    .select("date")
    .eq("ticker", ticker)
    .eq("type", "large-move");

  if (error) {
    console.error(`Failed to read event_annotations for stabilization pattern (${ticker}):`, error.message);
  }
  if (!moveRows || moveRows.length === 0) {
    return { medianTradingDays: null, sampleSize: 0, insufficientHistory: true };
  }

  const closes = await fetchHistoricalCloses(ticker, STABILIZATION_HISTORY_FETCH_DAYS);
  if (closes.length === 0) {
    return { medianTradingDays: null, sampleSize: 0, insufficientHistory: true };
  }

  const samples: number[] = [];
  for (const row of moveRows) {
    const eventIndex = indexAtOrBefore(closes, row.date);
    if (eventIndex === -1) continue;
    const days = daysToStabilize(closes, eventIndex);
    if (days != null) samples.push(days);
  }

  if (samples.length === 0) {
    return { medianTradingDays: null, sampleSize: 0, insufficientHistory: true };
  }

  return {
    medianTradingDays: median(samples),
    sampleSize: samples.length,
    insufficientHistory: samples.length < STABILIZATION_MIN_SAMPLE_SIZE,
  };
}
