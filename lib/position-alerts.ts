/**
 * Phase 39 -- real-time news alerts for currently-held positions. Wires
 * together infrastructure that already exists but had never talked to
 * each other for actual position monitoring: the same Finnhub
 * company-news fetch and Phase 16 classifier already used by the News
 * tab, Market Read, and the Event Timeline's catalyst lookup. No new
 * news-fetching path, no new classifier -- checkForAlertableNews is
 * pure orchestration over lib/finnhub.ts and lib/headline-
 * classification-service.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getFinnhubClient } from "./finnhub";
import { getOrClassifyHeadlines, stableHeadlineId } from "./headline-classification-service";
import type { IndividualCategory } from "./headline-classification";

/**
 * Categories significant enough to interrupt someone about a position
 * they currently hold -- deliberately excludes "notable-investor-move",
 * "financing-event", "new-to-watch", and "other", which are either too
 * routine or already surfaced elsewhere (financing-event has its own
 * dedicated Active Catalyst flag, Phase 33) to justify an email.
 */
export const ALERTABLE_CATEGORIES: readonly IndividualCategory[] = [
  "M&A-buyback",
  "partnership",
  "analyst-action",
  "earnings",
  "executive-change",
];

export interface AlertableNewsMatch {
  /** Stable id (lib/headline-classification-service.ts's stableHeadlineId) -- reused directly as alert_log's headline_hash, no second hash needed. */
  headlineId: string;
  headline: string;
  source: string;
  publishedAt: string; // ISO
  category: IndividualCategory;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetches this ticker's company news published after `sinceTimestamp`,
 * classifies it via the existing permanent cache (a headline already
 * classified for the News tab or Market Read is never re-classified
 * here), and returns only headlines in ALERTABLE_CATEGORIES. Finnhub's
 * own date range is day-granularity, so results are additionally
 * filtered to the exact timestamp to avoid re-surfacing something from
 * earlier the same day that was already checked.
 */
export async function checkForAlertableNews(
  supabase: SupabaseClient<Database>,
  ticker: string,
  sinceTimestamp: string
): Promise<AlertableNewsMatch[]> {
  const sinceMs = new Date(sinceTimestamp).getTime();
  const now = new Date();

  const raw = await getFinnhubClient().getCompanyNews(ticker, toIsoDate(new Date(sinceMs)), toIsoDate(now));
  const recent = raw.filter((n) => n.datetime * 1000 > sinceMs);
  if (recent.length === 0) return [];

  const headlines = recent.map((n) => {
    const publishedAt = new Date(n.datetime * 1000).toISOString();
    return {
      id: stableHeadlineId({ url: n.url, headline: n.headline, publishedAt }),
      headline: n.headline,
      source: n.source,
      summary: n.summary,
      publishedAt,
    };
  });

  const classified = await getOrClassifyHeadlines(supabase, headlines);

  const matches: AlertableNewsMatch[] = [];
  for (const h of headlines) {
    const c = classified.get(h.id);
    if (!c || c.level !== "individual") continue;
    if (!(ALERTABLE_CATEGORIES as readonly string[]).includes(c.category)) continue;
    matches.push({
      headlineId: h.id,
      headline: h.headline,
      source: h.source,
      publishedAt: h.publishedAt,
      category: c.category as IndividualCategory,
    });
  }
  return matches;
}

/**
 * True on a weekday between 9:30am and 4:00pm US/Eastern, computed via
 * the IANA timezone database (not a fixed UTC offset, which would drift
 * an hour for half the year across DST) -- "roughly" market hours per
 * the spec, not holiday-aware. Used to skip the check entirely outside
 * trading hours rather than polling Finnhub uselessly overnight.
 */
export function isWithinMarketHours(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);

  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight <= 16 * 60;
}

/** Plain-language label for the category shown in the alert email subject/body. */
export function alertCategoryLabel(category: IndividualCategory): string {
  switch (category) {
    case "M&A-buyback":
      return "M&A / buyback";
    case "partnership":
      return "partnership";
    case "analyst-action":
      return "analyst action";
    case "earnings":
      return "earnings";
    case "executive-change":
      return "executive change";
    default:
      return category;
  }
}
