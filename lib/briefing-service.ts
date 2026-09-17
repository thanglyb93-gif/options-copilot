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
import { catalystRecencyScore } from "./entry-score";
import { getDailyGenerationStatus, incrementDailyGenerationCount } from "./market-read-cap";
import type { DirectionalLean } from "./briefing";

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

/**
 * Records a lean_history row for a freshly-generated (not cache-hit)
 * per-ticker briefing, so its directional lean can later be checked
 * against price 10 trading days out (see app/api/lean-resolve). Only
 * called from getOrGenerateBriefing -- getOrGenerateTodaysSummary has no
 * real per-ticker price to snapshot, so it's deliberately excluded.
 */
async function recordLeanHistory(
  supabase: SupabaseClient<Database>,
  ticker: string,
  lean: BriefingContent["directionalLean"]["lean"],
  priceAtSnapshot: number | null
): Promise<void> {
  if (priceAtSnapshot == null) {
    console.error(`Skipping lean_history insert for ${ticker}: no current price available.`);
    return;
  }

  const { error } = await supabase.from("lean_history").insert({
    ticker,
    date: toIsoDate(new Date()),
    lean,
    price_at_snapshot: priceAtSnapshot,
  });

  if (error) {
    console.error(`Failed to insert lean_history row for ${ticker}:`, error.message);
  }
}

export interface CachedBriefingOnly {
  content: BriefingContent;
  generatedAt: string;
}

/**
 * Phase 42 -- reads the `briefings` table directly for `ticker` and
 * returns whatever is cached there, regardless of age, WITHOUT ever
 * calling generate() on a miss or stale-schema row. Used only by the
 * Ranking page's batch computation, which must stay strictly read-only
 * against Anthropic (a real generation call per watchlisted ticker on
 * every calculation would be both slow and expensive) -- ticker pages
 * and their manual Refresh button keep using getOrGenerateBriefing
 * above, unchanged.
 */
export async function getCachedBriefingOnly(
  supabase: SupabaseClient<Database>,
  ticker: string
): Promise<CachedBriefingOnly | null> {
  const { data: cached, error } = await supabase
    .from("briefings")
    .select("*")
    .eq("ticker", ticker)
    .maybeSingle();

  if (error) {
    console.error(`Failed to read briefing cache for ${ticker}:`, error.message);
    return null;
  }
  if (!cached) return null;

  try {
    return { content: parseBriefingContent(cached.content), generatedAt: cached.generated_at };
  } catch {
    // Stale schema (predates a briefing field) -- treat as no cache, same as a genuine miss.
    return null;
  }
}

export async function getOrGenerateBriefing(
  supabase: SupabaseClient<Database>,
  ticker: string,
  inputs: BriefingInputs,
  forceRefresh = false
): Promise<BriefingCacheResult> {
  const result = await cacheOrGenerate(
    supabase,
    ticker,
    CACHE_TTL_MS,
    () => generateBriefing(inputs),
    forceRefresh
  );

  if (!result.cached) {
    await recordLeanHistory(supabase, ticker, result.content.directionalLean.lean, inputs.quote.price);
  }

  return result;
}

/**
 * Phase 43 Part C -- the structured, no-new-API-call fallback shown when
 * a real generation is either capped or has genuinely failed. Every
 * field here comes from data already gathered for this ticker: catalyst
 * recency is the same mechanical (non-LLM) Events sub-score
 * lib/entry-score.ts computes, and cachedLean is whatever a PRIOR real
 * generation left behind, however old -- reusing getCachedBriefingOnly's
 * cache-only read (Phase 42) rather than a second mechanism, its age
 * always attached so staleness is stated, never hidden.
 */
export interface StructuredFactsFallback {
  catalystRecencyScore: number;
  cachedLean: { lean: DirectionalLean; rationale: string; generatedAt: string } | null;
}

export type BriefingOutcome =
  | { mode: "fresh-cache" | "generated"; content: BriefingContent; generatedAt: string; fallback: null }
  | { mode: "capped" | "failed"; content: null; generatedAt: null; fallback: StructuredFactsFallback };

/**
 * The single decision point every per-ticker briefing consumer (Market
 * Read, Entry Score's Events component) goes through, so the daily cap
 * applies identically regardless of which UI surface triggered the
 * check: a fresh cache is served as-is (cap-independent, same as
 * always); a stale-or-missing cache generates normally and increments
 * the shared daily counter ONLY when the cap isn't yet hit; once hit,
 * every remaining ticker that day gets the structured-facts fallback
 * instead, regardless of how stale that specific ticker's own cache is.
 * A genuine generation failure (Anthropic down/out of credits) gets the
 * identical fallback, replacing Phase 42's plain error-only fallback
 * with something that actually uses the data already on hand.
 */
export async function getBriefingRespectingDailyCap(
  supabase: SupabaseClient<Database>,
  ticker: string,
  context: BriefingContext,
  forceRefresh = false
): Promise<BriefingOutcome> {
  const cached = await getCachedBriefingOnly(supabase, ticker);
  // A manual Refresh click still has to clear the cap check below --
  // forceRefresh only skips treating a fresh cache as good enough, it
  // never lets a user bypass the daily limit by re-clicking.
  const isFresh =
    !forceRefresh && cached != null && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS;

  if (cached && isFresh) {
    return { mode: "fresh-cache", content: cached.content, generatedAt: cached.generatedAt, fallback: null };
  }

  const buildFallback = (): StructuredFactsFallback => ({
    catalystRecencyScore: catalystRecencyScore(context.daysSinceLastEarnings, context.recentHeadlineCount),
    cachedLean: cached
      ? {
          lean: cached.content.directionalLean.lean,
          rationale: cached.content.directionalLean.rationale,
          generatedAt: cached.generatedAt,
        }
      : null,
  });

  const status = await getDailyGenerationStatus(supabase);
  if (status.capHit) {
    return { mode: "capped", content: null, generatedAt: null, fallback: buildFallback() };
  }

  try {
    const result = await getOrGenerateBriefing(supabase, ticker, context.inputs, forceRefresh);
    await incrementDailyGenerationCount(supabase);
    return { mode: "generated", content: result.content, generatedAt: result.generatedAt, fallback: null };
  } catch (error) {
    console.error(`Briefing generation failed for ${ticker}, falling back to structured facts:`, error);
    return { mode: "failed", content: null, generatedAt: null, fallback: buildFallback() };
  }
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
    // Missing here means either dropped by response validation or the
    // whole batch failed (e.g. Anthropic out of credits/rate limited) --
    // either way, a neutral fallback keeps every headline visible on the
    // page rather than silently disappearing one, and `classified: false`
    // lets the UI show it plainly instead of as a real classification.
    const classification = classifications.get(h.id);
    return {
      id: h.id,
      headline: h.headline,
      source: h.source,
      url: rawHeadlines[i].url,
      summary: h.summary,
      publishedAt: h.publishedAt,
      level: classification?.level ?? "individual",
      category: classification?.category ?? "other",
      classified: classification != null,
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
