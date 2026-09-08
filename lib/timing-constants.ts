/**
 * Phase 33 timing-context adjustable constants, factored into their own
 * dependency-free module. lib/guidance-content.ts (imported by client
 * components, since it drives inline ImportanceBadge/label lookups
 * throughout the ticker dashboard) needs these values for its threshold
 * descriptions, but the modules that actually USE them to do their real
 * work -- lib/active-catalysts.ts, lib/entry-timing-checks.ts,
 * lib/stabilization-pattern.ts -- import yahoo-finance2/Finnhub/Supabase
 * clients, which cannot be bundled into client code. Keeping the numbers
 * here lets both sides import the same source of truth without guidance-
 * content.ts dragging server-only I/O into the client bundle.
 */

/** Calendar days of company-news scanned for financing-event headlines (Part A). */
export const ACTIVE_CATALYST_LOOKBACK_DAYS = 30;
/** How many trading days after settlement a financing event still counts as "active" (Part A). Adjustable. */
export const ACTIVE_CATALYST_WINDOW_TRADING_DAYS = 10;

/** A move within this many trading days of today counts as "recent" for entry-timing purposes (Part B). */
export const RECENT_MOVE_LOOKBACK_TRADING_DAYS = 3;

/** Realized vol must be back within this % of its pre-event baseline to count as "stabilized" (Part E). Adjustable. */
export const STABILIZATION_BAND_PCT = 20;
/** Trading-day window used for both the pre-event baseline and the forward-walked realized-vol reading (Part E). */
export const STABILIZATION_VOL_WINDOW = 5;
/** Give up on an event if it hasn't stabilized within this many trading days (Part E). */
export const MAX_STABILIZATION_LOOKAHEAD_TRADING_DAYS = 30;
/** Below this sample size, the median is labeled insufficient rather than presented as reliable (Part E). */
export const STABILIZATION_MIN_SAMPLE_SIZE = 3;
/** Calendar days of history fetched for the stabilization walk -- covers the Event Timeline's longest (3yr) window plus lookahead margin (Part E). */
export const STABILIZATION_HISTORY_FETCH_DAYS = 1200;
