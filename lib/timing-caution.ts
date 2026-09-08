/**
 * Phase 33 Part F -- consolidated timing caution. Combines Parts A
 * (active catalysts), B (recent significant move), C (realized-vol
 * trend), D (event digestion status) and E (this ticker's own
 * stabilization pattern) into one signal: has this ticker actually
 * finished digesting its last event/move, or is there still real reason
 * for caution before relying on the current premium? Never a directional
 * call on what happens next, and never subtracted from or otherwise
 * folded into lib/entry-score.ts's scoring math -- a separate, parallel
 * signal attached to the score display, not part of the score itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DailyClose } from "./yahoo";
import type { TradeDirection } from "./entry-score";
import { getActiveCatalysts } from "./active-catalysts";
import { checkRecentMove } from "./entry-timing-checks";
import { realizedVolTrend } from "./volatility";
import { computeStabilizationPattern } from "./stabilization-pattern";
import { computeEventDigestionStatus, describeEventDigestionStatus, DEFAULT_STABILIZATION_TRADING_DAYS } from "./event-digestion";

export interface TimingCautionContext {
  /** Same daily-closes series already fetched for this ticker elsewhere on the page (e.g. relative-strength) -- not re-fetched here. */
  historicals: DailyClose[];
  /** Today's front-month ATM IV, already computed by the caller. */
  currentIv: number | null;
  /** This ticker's real iv_history rows, already fetched by the caller. */
  ivHistory: { date: string; iv: number }[];
}

export interface TimingCautionResult {
  active: boolean;
  /** Full explanation, with actual values -- always populated when active, always empty when not. */
  reasoning: string[];
}

function pluralDays(n: number): string {
  return `${n} trading day${n === 1 ? "" : "s"}`;
}

/**
 * `direction` doesn't change which facts are checked -- a stacked timing
 * caution (unresolved catalyst / recent move + still-expanding realized
 * vol + not enough time elapsed) is equally relevant whichever side is
 * being sold. It's accepted for API-shape symmetry with this app's other
 * direction-scoped calls (and in case a future refinement needs it), not
 * used to filter results today.
 */
export async function evaluateTimingCaution(
  supabase: SupabaseClient<Database>,
  ticker: string,
  direction: TradeDirection,
  context: TimingCautionContext
): Promise<TimingCautionResult> {
  void direction;

  const [activeCatalysts, stabilization] = await Promise.all([
    getActiveCatalysts(supabase, ticker),
    computeStabilizationPattern(supabase, ticker),
  ]);
  const recentMove = checkRecentMove(ticker, context.historicals);
  const volTrend = realizedVolTrend(context.historicals);

  const reasoning: string[] = [];

  for (const catalyst of activeCatalysts) {
    if (catalyst.status === "closing-settled" && catalyst.daysSinceSettled != null) {
      reasoning.push(
        `Active catalyst: ${catalyst.headline} -- settled ${pluralDays(catalyst.daysSinceSettled)} ago (${catalyst.source}). Verify this catalyst's driver before relying on the current premium.`
      );
    } else {
      reasoning.push(
        `Unresolved catalyst: ${catalyst.headline}${catalyst.status ? ` (${catalyst.status})` : ""} (${catalyst.source}).`
      );
    }
  }

  if (recentMove.flagged && recentMove.pctChange != null && recentMove.daysAgo != null) {
    reasoning.push(
      `Recent ${recentMove.pctChange >= 0 ? "+" : ""}${recentMove.pctChange.toFixed(1)}% move ${pluralDays(recentMove.daysAgo)} ago -- verify this move's driver before relying on the current premium.`
    );
  }

  const hasTriggerEvent = activeCatalysts.length > 0 || recentMove.flagged;

  if (volTrend.trend === "expanding" && volTrend.today != null && volTrend.tenDaysAgo != null) {
    reasoning.push(
      `Realized volatility still expanding (5d: ${(volTrend.today * 100).toFixed(0)}%, 10d ago: ${(volTrend.tenDaysAgo * 100).toFixed(0)}%).`
    );
  }

  // How many trading days have elapsed since the most recent trigger
  // (whichever of an active-catalyst settlement or a recent move is more
  // recent), compared against this ticker's own typical stabilization
  // window -- or the conservative default when Part E lacks history.
  const triggerDaysAgoCandidates: number[] = [];
  for (const c of activeCatalysts) {
    if (c.daysSinceSettled != null) triggerDaysAgoCandidates.push(c.daysSinceSettled);
  }
  if (recentMove.daysAgo != null) triggerDaysAgoCandidates.push(recentMove.daysAgo);
  const daysSinceTrigger = triggerDaysAgoCandidates.length > 0 ? Math.min(...triggerDaysAgoCandidates) : null;

  const typicalDays = stabilization.insufficientHistory ? DEFAULT_STABILIZATION_TRADING_DAYS : stabilization.medianTradingDays!;
  const fewerThanTypical = daysSinceTrigger != null && daysSinceTrigger < typicalDays;

  if (fewerThanTypical) {
    reasoning.push(
      stabilization.insufficientHistory
        ? `Using a default ${typicalDays}-trading-day stabilization window (insufficient history for this ticker, n=${stabilization.sampleSize}) -- only ${pluralDays(daysSinceTrigger!)} elapsed.`
        : `This ticker's past moves typically take ${typicalDays} trading days to stabilize (n=${stabilization.sampleSize}) -- only ${pluralDays(daysSinceTrigger!)} elapsed.`
    );
  }

  const active = hasTriggerEvent && volTrend.trend === "expanding" && fewerThanTypical;

  if (active) {
    const digestionEventDate =
      activeCatalysts.find((c) => c.eventDate)?.eventDate ??
      (recentMove.daysAgo != null
        ? (context.historicals[context.historicals.length - 1 - recentMove.daysAgo]?.date ?? null)
        : null);

    if (digestionEventDate) {
      const digestion = computeEventDigestionStatus(
        digestionEventDate,
        context.historicals,
        context.ivHistory,
        context.currentIv,
        stabilization.insufficientHistory ? null : stabilization.medianTradingDays
      );
      if (digestion) reasoning.push(describeEventDigestionStatus(digestion));
    }
  }

  return { active, reasoning: active ? reasoning : [] };
}
