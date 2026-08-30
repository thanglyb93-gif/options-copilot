/**
 * Event Timeline (Phase 32): detects significant historical price moves
 * from data already fetched for free (Part A), then -- ONLY for those
 * specific flagged dates, never exhaustively -- fetches and classifies
 * news in a narrow window around each one to find what coincided with
 * it (Part B). This is retrieval/display of the past, explicitly not
 * prediction: every annotation describes what already happened and what
 * coincided with it, never what will happen next. Reuses lib/headline-
 * classification.ts's existing classifier (Phase 16) rather than
 * duplicating it, and lib/sector-groups.ts's existing peer mapping
 * (Phase 23) for the optional macro/sector overlay (Part C). Caching
 * (Part D) lives in getOrComputeEventTimeline below -- once an
 * annotation is computed for a ticker+date+type, it's permanent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EventAnnotationType } from "@/types/database";
import type { DailyClose } from "./yahoo";
import { fetchHistoricalCloses } from "./yahoo";
import { getFinnhubClient } from "./finnhub";
import { getOrClassifyHeadlines, stableHeadlineId } from "./headline-classification-service";
import { MACRO_CATEGORIES, type ClassifiableHeadline } from "./headline-classification";
import { peerTickersFor } from "./sector-groups";

// ---------------------------------------------------------------------------
// Part A -- significant move detection
// ---------------------------------------------------------------------------

export type EventTimelineWindow = "1w" | "1mo" | "3mo" | "1yr" | "3yr";

/** Calendar days of history to fetch/scan per window. */
export const WINDOW_DAYS: Record<EventTimelineWindow, number> = {
  "1w": 7,
  "1mo": 30,
  "3mo": 90,
  "1yr": 365,
  "3yr": 1095,
};

/** Windows short enough that a single day's move is the meaningful unit. */
const SINGLE_DAY_WINDOWS: readonly EventTimelineWindow[] = ["1w", "1mo"];

/** Single-day move threshold (%) for 1w/1mo views. Adjustable. */
export const SINGLE_DAY_MOVE_THRESHOLD_PCT = 5;
/** How many calendar days apart two single-day flags can be and still count as the same event (e.g. a 2-day earnings reaction). Adjustable. */
export const SINGLE_DAY_MERGE_WITHIN_DAYS = 2;

/** Rolling cumulative move threshold (%) for 3mo/1yr/3yr views. Adjustable. */
export const ROLLING_MOVE_THRESHOLD_PCT = 8;
/** Width of the rolling window (trading days) for 3mo/1yr/3yr views -- the "3-5 day cumulative" the brief calls for. Adjustable. */
export const ROLLING_WINDOW_DAYS = 5;

export type MoveDirection = "up" | "down";

export interface SignificantMove {
  date: string;
  pctChange: number;
  direction: MoveDirection;
}

function pctChangeBetween(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

function daysBetweenDates(a: string, b: string): number {
  return Math.abs(new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Collapses a run of candidate flags that are within `mergeWithinDays` of
 * each other into a single representative event (the one with the
 * largest absolute move) -- without this, a single sharp move triggers
 * the rolling-window check on every one of several consecutive days as
 * the window slides across it, producing many duplicate markers for
 * what a person would see as one event.
 */
function collapseClusters(moves: SignificantMove[], mergeWithinDays: number): SignificantMove[] {
  if (moves.length === 0) return [];
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date));
  const clusters: SignificantMove[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const cluster = clusters[clusters.length - 1];
    const last = cluster[cluster.length - 1];
    if (daysBetweenDates(last.date, sorted[i].date) <= mergeWithinDays) {
      cluster.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }

  return clusters.map((cluster) => cluster.reduce((best, m) => (Math.abs(m.pctChange) > Math.abs(best.pctChange) ? m : best)));
}

/**
 * Scans daily closes within the requested window for significant moves,
 * using a single-day threshold for short windows (1w/1mo) and a rolling
 * multi-day cumulative threshold for longer ones (3mo/1yr/3yr) -- the
 * same %-change-over-a-recent-span technique lib/flags.ts's
 * earningsCooldownFlag already uses, just scanned across the whole
 * window and banded by window length instead of one fixed check.
 */
export function detectSignificantMoves(
  historicals: DailyClose[],
  windowType: EventTimelineWindow
): SignificantMove[] {
  const cutoffDate = new Date(Date.now() - WINDOW_DAYS[windowType] * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const closes = historicals.filter((c) => c.date >= cutoffDate);
  if (closes.length < 2) return [];

  const useSingleDay = SINGLE_DAY_WINDOWS.includes(windowType);
  const candidates: SignificantMove[] = [];

  if (useSingleDay) {
    for (let i = 1; i < closes.length; i++) {
      const pct = pctChangeBetween(closes[i - 1].close, closes[i].close);
      if (Math.abs(pct) >= SINGLE_DAY_MOVE_THRESHOLD_PCT) {
        candidates.push({ date: closes[i].date, pctChange: pct, direction: pct >= 0 ? "up" : "down" });
      }
    }
    return collapseClusters(candidates, SINGLE_DAY_MERGE_WITHIN_DAYS);
  }

  for (let i = ROLLING_WINDOW_DAYS; i < closes.length; i++) {
    const pct = pctChangeBetween(closes[i - ROLLING_WINDOW_DAYS].close, closes[i].close);
    if (Math.abs(pct) >= ROLLING_MOVE_THRESHOLD_PCT) {
      candidates.push({ date: closes[i].date, pctChange: pct, direction: pct >= 0 ? "up" : "down" });
    }
  }
  return collapseClusters(candidates, ROLLING_WINDOW_DAYS);
}

// ---------------------------------------------------------------------------
// Part B -- targeted news correlation (only around flagged dates)
// ---------------------------------------------------------------------------

/** Default +/- window (calendar days) searched around a flagged date for a catalyst. */
export const DEFAULT_CATALYST_WINDOW_DAYS = 3;

export interface Catalyst {
  headline: string;
  source: string;
  classification: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function newsInWindow(items: { headline: string; source: string; summary: string; datetime: number; url: string }[]): ClassifiableHeadline[] {
  return items.map((n) => {
    const publishedAt = new Date(n.datetime * 1000).toISOString();
    return {
      id: stableHeadlineId({ url: n.url, headline: n.headline, publishedAt }),
      headline: n.headline,
      source: n.source,
      summary: n.summary,
      publishedAt,
    };
  });
}

/**
 * Fetches this ticker's own company-news in a narrow window around
 * `date` and returns the company-specific (non-macro) headline whose
 * publish date sits closest to it, classified via the existing Phase 16
 * classifier (reused via its permanent cache, not duplicated). Null
 * when nothing relevant turns up -- callers must render that as "no
 * catalyst found," never omit the date or fabricate an explanation.
 */
export async function findCatalystNearDate(
  supabase: SupabaseClient<Database>,
  ticker: string,
  date: string,
  windowDays = DEFAULT_CATALYST_WINDOW_DAYS
): Promise<Catalyst | null> {
  const center = new Date(`${date}T00:00:00Z`);
  const from = toIsoDate(new Date(center.getTime() - windowDays * 24 * 60 * 60 * 1000));
  const to = toIsoDate(new Date(center.getTime() + windowDays * 24 * 60 * 60 * 1000));

  const raw = await getFinnhubClient().getCompanyNews(ticker, from, to);
  if (raw.length === 0) return null;

  const headlines = newsInWindow(raw);
  const classifications = await getOrClassifyHeadlines(supabase, headlines);

  const companySpecific = headlines.filter((h) => classifications.get(h.id)?.level === "individual");
  if (companySpecific.length === 0) return null;

  const closest = companySpecific.reduce((best, h) =>
    Math.abs(new Date(h.publishedAt).getTime() - center.getTime()) <
    Math.abs(new Date(best.publishedAt).getTime() - center.getTime())
      ? h
      : best
  );

  const classification = classifications.get(closest.id)!;
  return { headline: closest.headline, source: closest.source, classification: classification.category };
}

// ---------------------------------------------------------------------------
// Part B (continued) -- earnings dates in range, regardless of move size
// ---------------------------------------------------------------------------

/**
 * Historical earnings dates for `ticker` within [from, to] -- Finnhub's
 * earnings-calendar endpoint already accepts any date range (the
 * "next earnings" route just never asked for a past one); this is the
 * missing past-range caller, not a new endpoint.
 */
export async function fetchHistoricalEarningsDates(ticker: string, from: string, to: string): Promise<string[]> {
  const calendar = await getFinnhubClient().getEarningsCalendar(ticker, from, to);
  return calendar.earningsCalendar
    .filter((e) => e.symbol === ticker)
    .map((e) => e.date)
    .sort();
}

// ---------------------------------------------------------------------------
// Part C -- optional macro/sector overlay (off by default)
// ---------------------------------------------------------------------------

/** Cap on how many sector peers get checked per flagged date, to keep the overlay's cost bounded. */
export const MACRO_OVERLAY_MAX_PEERS = 2;

export interface MacroOverlayEvent extends Catalyst {
  /** Which sector peer's news this macro-relevant headline actually came from. */
  viaTicker: string;
}

/**
 * Only meaningful for a ticker with a defined sector group (lib/sector-
 * groups.ts) -- there is no free, date-ranged "general macro news"
 * endpoint available to this app (Finnhub's own general-news endpoint
 * only returns recent items, not a historical range), so instead this
 * checks up to MACRO_OVERLAY_MAX_PEERS sector peers' own company-news in
 * the same narrow window and surfaces any headline THEY published that
 * classifies as macro-level -- e.g. a peer's earnings call mentioning a
 * broad semiconductor-sector headwind. A peer's macro-classified
 * headline is treated as sector-relevant context for this ticker too,
 * never as something specific to this company (kept visually and
 * structurally distinct -- see EventAnnotationRow.type "macro").
 */
export async function findMacroOverlayNearDate(
  supabase: SupabaseClient<Database>,
  ticker: string,
  date: string,
  windowDays = DEFAULT_CATALYST_WINDOW_DAYS
): Promise<MacroOverlayEvent | null> {
  const peers = peerTickersFor(ticker).slice(0, MACRO_OVERLAY_MAX_PEERS);
  if (peers.length === 0) return null;

  const center = new Date(`${date}T00:00:00Z`);
  const from = toIsoDate(new Date(center.getTime() - windowDays * 24 * 60 * 60 * 1000));
  const to = toIsoDate(new Date(center.getTime() + windowDays * 24 * 60 * 60 * 1000));

  for (const peer of peers) {
    const raw = await getFinnhubClient().getCompanyNews(peer, from, to);
    if (raw.length === 0) continue;

    const headlines = newsInWindow(raw);
    const classifications = await getOrClassifyHeadlines(supabase, headlines);

    const macroHeadlines = headlines.filter((h) => {
      const c = classifications.get(h.id);
      return c?.level === "macro" && (MACRO_CATEGORIES as readonly string[]).includes(c.category);
    });
    if (macroHeadlines.length === 0) continue;

    const closest = macroHeadlines.reduce((best, h) =>
      Math.abs(new Date(h.publishedAt).getTime() - center.getTime()) <
      Math.abs(new Date(best.publishedAt).getTime() - center.getTime())
        ? h
        : best
    );
    const classification = classifications.get(closest.id)!;
    return { headline: closest.headline, source: closest.source, classification: classification.category, viaTicker: peer };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Part D -- permanent cache orchestration
// ---------------------------------------------------------------------------

/** id-less annotation shape -- what callers (the API route, the UI) actually need; the DB row's id is an implementation detail of the cache. */
export interface EventAnnotation {
  ticker: string;
  date: string;
  type: EventAnnotationType;
  pct_change: number | null;
  headline: string | null;
  source: string | null;
  classification: string | null;
}

export interface EventTimelineResult {
  series: DailyClose[];
  annotations: EventAnnotation[];
}

/**
 * The one function the API route calls. Detection (Part A) is pure and
 * free, so it's simply re-run every time -- only the expensive part
 * (Part B/C's Finnhub + Claude lookups) is checked against the
 * permanent cache first, and only genuinely new ticker+date+type
 * combinations get computed and upserted. macro rows are always
 * excluded from the returned list when includeMacro is false, even if
 * a prior request with includeMacro=true already cached some.
 */
export async function getOrComputeEventTimeline(
  supabase: SupabaseClient<Database>,
  ticker: string,
  window: EventTimelineWindow,
  includeMacro: boolean
): Promise<EventTimelineResult> {
  const days = WINDOW_DAYS[window];
  const series = await fetchHistoricalCloses(ticker, days);

  const fromDate = series[0]?.date ?? toIsoDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const toDate = toIsoDate(new Date());

  const { data: cachedRows, error: readError } = await supabase
    .from("event_annotations")
    .select("*")
    .eq("ticker", ticker)
    .gte("date", fromDate)
    .lte("date", toDate);

  if (readError) {
    console.error(`Failed to read event_annotations cache for ${ticker}:`, readError.message);
  }
  const cached = cachedRows ?? [];
  const cachedByTypeAndDate = new Set(cached.map((r) => `${r.type}|${r.date}`));

  // Large moves -- detect fresh (free); only fetch/classify catalysts for
  // dates not already cached, and in parallel (not a sequential await
  // loop) -- a 3yr window's first-ever load could otherwise chain many
  // Finnhub + Claude round-trips back to back and risk a serverless
  // function timeout. Each lookup is independent, so bounding by the
  // slowest single call rather than their sum is both faster and safe.
  //
  // Each lookup is also individually fault-isolated: a genuine "no
  // headlines found" result is a permanent fact, safe to cache as
  // catalyst: null forever -- but a transient failure (Finnhub down,
  // Claude rate-limited/out of credit) is NOT the same thing and must
  // never be cached as if it were, or a real outage would permanently
  // poison that date's annotation. Failed lookups still surface the
  // move itself in this response (with no catalyst), just excluded from
  // the permanent upsert so a later request retries them.
  const moves = detectSignificantMoves(series, window);
  const uncachedMoves = moves.filter((m) => !cachedByTypeAndDate.has(`large-move|${m.date}`));
  const moveResults = await Promise.all(
    uncachedMoves.map(async (move): Promise<{ row: EventAnnotation; cacheable: boolean }> => {
      try {
        const catalyst = await findCatalystNearDate(supabase, ticker, move.date);
        return {
          cacheable: true,
          row: {
            ticker,
            date: move.date,
            type: "large-move",
            pct_change: move.pctChange,
            headline: catalyst?.headline ?? null,
            source: catalyst?.source ?? null,
            classification: catalyst?.classification ?? null,
          },
        };
      } catch (error) {
        console.error(`Catalyst lookup failed for ${ticker} on ${move.date}:`, error);
        return {
          cacheable: false,
          row: { ticker, date: move.date, type: "large-move", pct_change: move.pctChange, headline: null, source: null, classification: null },
        };
      }
    })
  );
  const moveRows = moveResults.filter((r) => r.cacheable).map((r) => r.row);
  const uncachedMoveRows = moveResults.map((r) => r.row); // includes non-cacheable rows, for the response only

  // Earnings dates -- always included regardless of move size, only for
  // dates not already cached. Best-effort: a Finnhub hiccup here
  // shouldn't take down the whole timeline (moves/macro still render).
  const earningsDates = await fetchHistoricalEarningsDates(ticker, fromDate, toDate).catch((error) => {
    console.error(`Failed to fetch historical earnings dates for ${ticker}:`, error);
    return [];
  });
  const earningsRows: EventAnnotation[] = earningsDates
    .filter((date) => !cachedByTypeAndDate.has(`earnings|${date}`))
    .map((date) => ({ ticker, date, type: "earnings", pct_change: null, headline: null, source: null, classification: null }));

  // Macro/sector overlay -- only when requested, only for the same flagged move dates (same cost-bounding principle as Part B), also parallelized and fault-isolated the same way.
  let macroRows: EventAnnotation[] = [];
  let uncachedMacroRows: EventAnnotation[] = [];
  if (includeMacro) {
    const uncachedMacroMoves = moves.filter((m) => !cachedByTypeAndDate.has(`macro|${m.date}`));
    const macroResults = await Promise.all(
      uncachedMacroMoves.map(async (move): Promise<{ row: EventAnnotation | null; cacheable: boolean }> => {
        try {
          const macroEvent = await findMacroOverlayNearDate(supabase, ticker, move.date);
          if (!macroEvent) return { row: null, cacheable: true }; // genuinely nothing found -- permanent
          return {
            cacheable: true,
            row: {
              ticker,
              date: move.date,
              type: "macro",
              pct_change: null,
              headline: `${macroEvent.headline} (via ${macroEvent.viaTicker})`,
              source: macroEvent.source,
              classification: macroEvent.classification,
            },
          };
        } catch (error) {
          console.error(`Macro overlay lookup failed for ${ticker} on ${move.date}:`, error);
          return { row: null, cacheable: false };
        }
      })
    );
    macroRows = macroResults.filter((r) => r.cacheable && r.row != null).map((r) => r.row!);
    uncachedMacroRows = macroResults.filter((r) => !r.cacheable && r.row != null).map((r) => r.row!);
  }

  // Only genuinely permanent results (cacheable: true) get upserted --
  // transient failures are surfaced below but never written to the
  // permanent cache.
  const cacheableRows: EventAnnotation[] = [...moveRows, ...earningsRows, ...macroRows];

  if (cacheableRows.length > 0) {
    const { error: upsertError } = await supabase
      .from("event_annotations")
      .upsert(cacheableRows, { onConflict: "ticker,date,type" });
    if (upsertError) {
      console.error(`Failed to cache event annotations for ${ticker}:`, upsertError.message);
    }
  }

  const combined: EventAnnotation[] = [
    ...cached.map(({ ticker: t, date, type, pct_change, headline, source, classification }) => ({
      ticker: t,
      date,
      type,
      pct_change,
      headline,
      source,
      classification,
    })),
    ...uncachedMoveRows,
    ...earningsRows,
    ...macroRows,
    ...uncachedMacroRows,
  ];
  const annotations = includeMacro ? combined : combined.filter((r) => r.type !== "macro");

  return { series, annotations };
}
