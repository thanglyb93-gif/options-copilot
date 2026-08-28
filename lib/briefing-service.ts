/**
 * I/O orchestration for briefings: gathering the raw inputs a briefing (or
 * entry score) needs, and the cache-or-generate flow against Supabase.
 * Kept separate from lib/briefing.ts, which stays pure prompt/schema/
 * validation logic plus the single Anthropic call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Quote } from "yahoo-finance2/modules/quote";
import type { Database } from "@/types/database";
import { fetchQuote, fetchHistoricalCloses, simpleMovingAverage, type DailyClose } from "./yahoo";
import { getFinnhubClient, fetchGeneralMarketNews } from "./finnhub";
import { earningsCooldownFlag } from "./flags";
import { describeTrend } from "./trend";
import {
  generateBriefing,
  parseBriefingContent,
  type BriefingContent,
  type BriefingInputs,
} from "./briefing";
import { generateTodaysSummary, type TodaysSummaryInputs } from "./todays-summary";
import { getOrClassifyHeadlines, stableHeadlineId } from "./headline-classification-service";
import type { ClassifiableHeadline, HeadlineCategory, HeadlineLevel } from "./headline-classification";

const EARNINGS_LOOKBACK_DAYS = 14;
const EARNINGS_LOOKAHEAD_DAYS = 120;
const NEWS_LOOKBACK_DAYS = 14;
const MAX_HEADLINES_IN_PROMPT = 8;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const TODAYS_SUMMARY_CACHE_KEY = "__TODAYS_SUMMARY__";
const TODAYS_SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NEWS_PAGE_HEADLINE_LIMIT = 50;
const MAX_HEADLINES_PER_LEVEL_IN_PROMPT = 20;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface BriefingContext {
  inputs: BriefingInputs;
  /** Days since the most recent past earnings event, or null if none within the lookback window. */
  daysSinceLastEarnings: number | null;
  /** Total company headlines found in the last NEWS_LOOKBACK_DAYS days (uncapped, unlike inputs.companyHeadlines). */
  recentHeadlineCount: number;
  quote: Quote;
  closes: DailyClose[];
}

/**
 * Gathers everything a briefing prompt needs, plus a couple of raw facts
 * (days since last earnings, headline count) that entry scoring needs but
 * aren't part of the briefing's own inputs or output.
 */
export async function gatherBriefingContext(ticker: string): Promise<BriefingContext> {
  const finnhub = getFinnhubClient();
  const today = new Date();
  const earningsFrom = new Date(today.getTime() - EARNINGS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const earningsTo = new Date(today.getTime() + EARNINGS_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const newsFrom = new Date(today.getTime() - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [quote, closes, calendar, companyNews, marketNews] = await Promise.all([
    fetchQuote(ticker),
    fetchHistoricalCloses(ticker, 300),
    finnhub.getEarningsCalendar(ticker, toIsoDate(earningsFrom), toIsoDate(earningsTo)),
    finnhub.getCompanyNews(ticker, toIsoDate(newsFrom), toIsoDate(today)),
    fetchGeneralMarketNews(),
  ]);

  const price = quote.regularMarketPrice ?? null;
  const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh ?? null;
  const percentFrom52wHigh =
    price != null && fiftyTwoWeekHigh
      ? ((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100
      : null;

  const todayIso = toIsoDate(today);
  const events = calendar.earningsCalendar.filter((e) => e.symbol === ticker);
  const upcoming = events
    .filter((e) => e.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const mostRecentPast = events
    .filter((e) => e.date < todayIso)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const daysUntilEarnings = upcoming
    ? Math.max(
        0,
        Math.round((new Date(upcoming.date).getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      )
    : null;

  const daysSinceLastEarnings = mostRecentPast
    ? Math.max(
        0,
        Math.round(
          (today.getTime() - new Date(mostRecentPast.date).getTime()) / (24 * 60 * 60 * 1000)
        )
      )
    : null;

  const cooldown = earningsCooldownFlag(closes);
  const earningsSoon = daysUntilEarnings != null && daysUntilEarnings <= 3;

  const trendDescription =
    price != null
      ? describeTrend({
          price,
          sma20: simpleMovingAverage(closes, 20),
          sma50: simpleMovingAverage(closes, 50),
          sma200: simpleMovingAverage(closes, 200),
        })
      : "Not enough history to assess trend.";

  const toHeadline = (n: { headline: string; source: string; summary: string; datetime: number }) => ({
    headline: n.headline,
    source: n.source,
    summary: n.summary,
    publishedAt: new Date(n.datetime * 1000).toISOString(),
  });

  const inputs: BriefingInputs = {
    ticker,
    quote: {
      price,
      dayChangePercent: quote.regularMarketChangePercent ?? null,
      fiftyTwoWeekHigh,
      percentFrom52wHigh,
    },
    earnings: {
      nextEarningsDate: upcoming?.date ?? null,
      daysUntilEarnings,
      earningsCooldownFlagged: cooldown.flagged || earningsSoon,
      percentMoveLast10TradingDays: cooldown.percentMove,
    },
    trendDescription,
    companyHeadlines: companyNews.slice(0, MAX_HEADLINES_IN_PROMPT).map(toHeadline),
    marketHeadlines: marketNews.slice(0, MAX_HEADLINES_IN_PROMPT).map(toHeadline),
  };

  return {
    inputs,
    daysSinceLastEarnings,
    recentHeadlineCount: companyNews.length,
    quote,
    closes,
  };
}

export interface BriefingCacheResult {
  content: BriefingContent;
  generatedAt: string;
  cached: boolean;
}

/**
 * Shared cache-or-generate flow against the `briefings` table, keyed by
 * `key` (a ticker for per-ticker briefings, or the fixed Today's Summary key).
 * Returns a cached row if one exists, is fresh (<ttlMs), and validates
 * against the current schema; otherwise calls `generate`, upserts, and
 * returns the fresh result. A cached row that predates a schema change
 * (e.g. missing directionalLean) fails validation and is treated as a miss.
 */
async function cacheOrGenerate(
  supabase: SupabaseClient<Database>,
  key: string,
  ttlMs: number,
  generate: () => Promise<BriefingContent>,
  forceRefresh: boolean
): Promise<BriefingCacheResult> {
  if (!forceRefresh) {
    const { data: cached, error: cacheReadError } = await supabase
      .from("briefings")
      .select("*")
      .eq("ticker", key)
      .maybeSingle();

    if (cacheReadError) {
      console.error(`Failed to read briefing cache for ${key}:`, cacheReadError.message);
    }

    if (cached) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      if (age < ttlMs) {
        try {
          const content = parseBriefingContent(cached.content);
          return { content, generatedAt: cached.generated_at, cached: true };
        } catch {
          // Stale schema -- fall through and regenerate.
        }
      }
    }
  }

  const content = await generate();
  const generatedAt = new Date().toISOString();

  const { error: upsertError } = await supabase
    .from("briefings")
    .upsert({ ticker: key, content, generated_at: generatedAt }, { onConflict: "ticker" });

  if (upsertError) {
    console.error(`Failed to cache briefing for ${key}:`, upsertError.message);
  }

  return { content, generatedAt, cached: false };
}

export async function getOrGenerateBriefing(
  supabase: SupabaseClient<Database>,
  ticker: string,
  inputs: BriefingInputs,
  forceRefresh = false
): Promise<BriefingCacheResult> {
  return cacheOrGenerate(supabase, ticker, CACHE_TTL_MS, () => generateBriefing(inputs), forceRefresh);
}

/** A general-market headline, classified into a level + category (see lib/headline-classification.ts). */
export interface ClassifiedNewsHeadline {
  id: string;
  headline: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  level: HeadlineLevel;
  category: HeadlineCategory;
}

export interface TodaysSummaryContext {
  inputs: TodaysSummaryInputs;
  /** Every fetched headline (up to NEWS_PAGE_HEADLINE_LIMIT), classified, most-recent-first -- feeds the page's categorized groups. */
  headlines: ClassifiedNewsHeadline[];
}

/**
 * Gathers general-market headlines, classifies each one (cached
 * permanently per headline -- see lib/headline-classification-service.ts),
 * and pulls the current watchlist, for both Today's Summary's prompt and
 * the News page's categorized headline groups.
 */
export async function gatherTodaysSummaryContext(
  supabase: SupabaseClient<Database>
): Promise<TodaysSummaryContext> {
  const [rawHeadlines, watchlistResult] = await Promise.all([
    fetchGeneralMarketNews(NEWS_PAGE_HEADLINE_LIMIT),
    supabase.from("watchlist").select("ticker"),
  ]);

  if (watchlistResult.error) {
    console.error("Failed to read watchlist for Today's Summary:", watchlistResult.error.message);
  }
  const watchlistTickers = (watchlistResult.data ?? []).map((r) => r.ticker);

  const classifiable: ClassifiableHeadline[] = rawHeadlines.map((n) => {
    const publishedAt = new Date(n.datetime * 1000).toISOString();
    return {
      id: stableHeadlineId({ url: n.url, headline: n.headline, publishedAt }),
      headline: n.headline,
      source: n.source,
      summary: n.summary,
      publishedAt,
    };
  });

  const classifications = await getOrClassifyHeadlines(supabase, classifiable);

  const headlines: ClassifiedNewsHeadline[] = classifiable.map((h, i) => {
    // Fallback for the rare case a classification failed validation and was
    // dropped -- keeps every headline visible on the page rather than
    // silently disappearing one.
    const classification = classifications.get(h.id) ?? { level: "individual" as const, category: "other" as const };
    return {
      id: h.id,
      headline: h.headline,
      source: h.source,
      url: rawHeadlines[i].url,
      summary: h.summary,
      publishedAt: h.publishedAt,
      level: classification.level,
      category: classification.category,
    };
  });

  const macroHeadlines = headlines.filter((h) => h.level === "macro");
  const individualHeadlines = headlines.filter((h) => h.level === "individual");

  const toBriefingHeadline = (h: ClassifiedNewsHeadline) => ({
    headline: h.headline,
    source: h.source,
    summary: h.summary,
    publishedAt: h.publishedAt,
  });

  const inputs: TodaysSummaryInputs = {
    asOf: new Date().toISOString(),
    watchlistTickers,
    macroHeadlines: macroHeadlines.slice(0, MAX_HEADLINES_PER_LEVEL_IN_PROMPT).map(toBriefingHeadline),
    individualHeadlines: individualHeadlines
      .slice(0, MAX_HEADLINES_PER_LEVEL_IN_PROMPT)
      .map(toBriefingHeadline),
  };

  return { inputs, headlines };
}

/**
 * Cache-or-generate for the single, fixed-key daily Today's Summary --
 * same table and TTL-based freshness check as per-ticker briefings, just
 * a longer TTL (market-wide news moves less per-minute than single-stock
 * news) and a fixed cache key instead of a ticker.
 */
export async function getOrGenerateTodaysSummary(
  supabase: SupabaseClient<Database>,
  inputs: TodaysSummaryInputs,
  forceRefresh = false
): Promise<BriefingCacheResult> {
  return cacheOrGenerate(
    supabase,
    TODAYS_SUMMARY_CACHE_KEY,
    TODAYS_SUMMARY_CACHE_TTL_MS,
    () => generateTodaysSummary(inputs),
    forceRefresh
  );
}
