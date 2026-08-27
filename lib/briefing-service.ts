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

const EARNINGS_LOOKBACK_DAYS = 14;
const EARNINGS_LOOKAHEAD_DAYS = 120;
const NEWS_LOOKBACK_DAYS = 14;
const MAX_HEADLINES_IN_PROMPT = 8;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
 * Returns a cached briefing if one exists, is fresh (<4h), and validates
 * against the current schema; otherwise generates, upserts, and returns a
 * fresh one. A cached row that predates a schema change (e.g. missing
 * directionalLean) fails validation and is treated as a miss.
 */
export async function getOrGenerateBriefing(
  supabase: SupabaseClient<Database>,
  ticker: string,
  inputs: BriefingInputs,
  forceRefresh = false
): Promise<BriefingCacheResult> {
  if (!forceRefresh) {
    const { data: cached, error: cacheReadError } = await supabase
      .from("briefings")
      .select("*")
      .eq("ticker", ticker)
      .maybeSingle();

    if (cacheReadError) {
      console.error(`Failed to read briefing cache for ${ticker}:`, cacheReadError.message);
    }

    if (cached) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      if (age < CACHE_TTL_MS) {
        try {
          const content = parseBriefingContent(cached.content);
          return { content, generatedAt: cached.generated_at, cached: true };
        } catch {
          // Stale schema -- fall through and regenerate.
        }
      }
    }
  }

  const content = await generateBriefing(inputs);
  const generatedAt = new Date().toISOString();

  const { error: upsertError } = await supabase
    .from("briefings")
    .upsert({ ticker, content, generated_at: generatedAt }, { onConflict: "ticker" });

  if (upsertError) {
    console.error(`Failed to cache briefing for ${ticker}:`, upsertError.message);
  }

  return { content, generatedAt, cached: false };
}
