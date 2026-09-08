/**
 * Phase 33 Part B -- post-rally/post-move entry caution. A purely factual
 * "you're entering shortly after a large move" flag, framed as "verify
 * this move's driver before relying on the current premium" -- never a
 * directional call on what happens next. Reuses lib/event-timeline.ts's
 * (Phase 32) detectSignificantMoves() directly rather than a second
 * move-detection implementation.
 */

import { detectSignificantMoves, type MoveDirection } from "./event-timeline";
import type { DailyClose } from "./yahoo";
import { tradingDaysElapsed } from "./trading-days";
import { RECENT_MOVE_LOOKBACK_TRADING_DAYS } from "./timing-constants";

export interface RecentMoveCheck {
  flagged: boolean;
  pctChange: number | null;
  daysAgo: number | null;
  direction: MoveDirection | null;
}

/**
 * Checks for a significant move (Phase 32's single-day 1mo-window
 * detection) within the last RECENT_MOVE_LOOKBACK_TRADING_DAYS trading
 * days. `ticker` isn't needed by the detection itself (that's pure over
 * `historicals`) but is kept in the signature for parity with this
 * phase's other per-ticker timing checks.
 */
export function checkRecentMove(ticker: string, historicals: DailyClose[]): RecentMoveCheck {
  void ticker;
  if (historicals.length < 2) {
    return { flagged: false, pctChange: null, daysAgo: null, direction: null };
  }

  const moves = detectSignificantMoves(historicals, "1mo");
  if (moves.length === 0) {
    return { flagged: false, pctChange: null, daysAgo: null, direction: null };
  }

  // detectSignificantMoves' collapseClusters returns moves sorted ascending by date.
  const mostRecent = moves[moves.length - 1];
  const daysAgo = tradingDaysElapsed(historicals, mostRecent.date);
  if (daysAgo == null || daysAgo > RECENT_MOVE_LOOKBACK_TRADING_DAYS) {
    return { flagged: false, pctChange: null, daysAgo: null, direction: null };
  }

  return { flagged: true, pctChange: mostRecent.pctChange, daysAgo, direction: mostRecent.direction };
}
