/**
 * Phase 33 Part A -- active/unresolved financing-event catalysts. Answers
 * "has this settled down yet," never "what will happen": a debt/
 * convertible-note offering, share exchange, secondary offering, or lockup
 * expiration stays "active" for a bounded window after it settles, then
 * drops off this flag (though it remains visible as permanent history in
 * the Phase 32 Event Timeline via its own catalyst lookup). Reuses the
 * exact same Finnhub company-news fetch and Phase 16 classifier/cache
 * already used by the News tab and Market Read -- no second news path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getFinnhubClient } from "./finnhub";
import { getOrClassifyHeadlines, stableHeadlineId } from "./headline-classification-service";
import type { FinancingEventStatus } from "./headline-classification";
import { fetchHistoricalCloses } from "./yahoo";
import { tradingDaysElapsed } from "./trading-days";
import { ACTIVE_CATALYST_LOOKBACK_DAYS, ACTIVE_CATALYST_WINDOW_TRADING_DAYS } from "./timing-constants";

export interface ActiveCatalyst {
  headline: string;
  source: string;
  status: FinancingEventStatus | null;
  eventDate: string | null;
  /** Trading days since settlement -- only set when status is "closing-settled" and a date was extracted. */
  daysSinceSettled: number | null;
  active: boolean;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Financing-event headlines for `ticker` still considered active: not yet
 * settled (status "announced"/"pricing", or unclear), or settled within
 * the last ACTIVE_CATALYST_WINDOW_TRADING_DAYS trading days.
 */
export async function getActiveCatalysts(
  supabase: SupabaseClient<Database>,
  ticker: string
): Promise<ActiveCatalyst[]> {
  const to = new Date();
  const from = new Date(to.getTime() - ACTIVE_CATALYST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const raw = await getFinnhubClient().getCompanyNews(ticker, toIsoDate(from), toIsoDate(to));
  if (raw.length === 0) return [];

  const headlines = raw.map((n) => {
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
  const financingHeadlines = headlines.filter((h) => classified.get(h.id)?.category === "financing-event");
  if (financingHeadlines.length === 0) return [];

  const closes = await fetchHistoricalCloses(ticker, ACTIVE_CATALYST_LOOKBACK_DAYS + 30);

  const results: ActiveCatalyst[] = financingHeadlines.map((h) => {
    const c = classified.get(h.id)!;
    const status = c.financingStatus ?? null;
    const eventDate = c.financingEventDate ?? null;
    const daysSinceSettled =
      status === "closing-settled" && eventDate ? tradingDaysElapsed(closes, eventDate) : null;
    // Unresolved (announced/pricing) or genuinely unclear status stays
    // active indefinitely -- we can't yet tell it's been resolved.
    // Settled status expires after the trading-day window.
    const active =
      status !== "closing-settled" || (daysSinceSettled != null && daysSinceSettled <= ACTIVE_CATALYST_WINDOW_TRADING_DAYS);
    return { headline: h.headline, source: h.source, status, eventDate, daysSinceSettled, active };
  });

  return results.filter((r) => r.active);
}
