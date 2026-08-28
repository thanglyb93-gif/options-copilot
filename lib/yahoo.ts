import YahooFinance from "yahoo-finance2";
import type { Quote } from "yahoo-finance2/modules/quote";
import type { Option, OptionsResult } from "yahoo-finance2/modules/options";

type YahooFinanceClient = InstanceType<typeof YahooFinance>;

let client: YahooFinanceClient | null = null;

/**
 * yahoo-finance2 falls back to `globalThis.fetch` for its HTTP calls when
 * no override is given. In a Next.js server context that's Next's patched
 * fetch, which applies its own persistent Data Cache to GET requests --
 * the exact same class of bug found and fixed for supabase-js in
 * lib/supabase.ts (a 20-row insert that kept reading back as 1 row).
 * Here it means quote()/options() can silently serve a stale snapshot in
 * production (e.g. a contract's bid/ask/lastPrice frozen from whenever
 * that route was first cached), even though a fresh request to Yahoo
 * would return current data. Every options-data read must be live, so
 * this opts out centrally, once, the same way the Supabase clients do.
 */
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

function getYahooClient(): YahooFinanceClient {
  if (!client) {
    // Yahoo's unofficial endpoints log warnings about schema drift; not
    // actionable for this app, so keep them out of server logs.
    client = new YahooFinance({ suppressNotices: ["yahooSurvey"], fetch: noStoreFetch });
  }
  return client;
}

export async function fetchQuote(ticker: string): Promise<Quote> {
  return getYahooClient().quote(ticker);
}

export interface AnalystTargets {
  targetHigh?: number;
  targetLow?: number;
  targetMean?: number;
  recommendationKey?: string;
  numberOfAnalysts?: number;
}

export interface DividendCalendar {
  exDividendDate?: Date;
}

export async function fetchQuoteSummaryExtras(ticker: string): Promise<{
  analystTargets: AnalystTargets;
  dividendCalendar: DividendCalendar;
  beta?: number;
}> {
  const summary = await getYahooClient().quoteSummary(ticker, {
    modules: ["financialData", "calendarEvents", "defaultKeyStatistics"],
  });

  return {
    analystTargets: {
      targetHigh: summary.financialData?.targetHighPrice,
      targetLow: summary.financialData?.targetLowPrice,
      targetMean: summary.financialData?.targetMeanPrice,
      recommendationKey: summary.financialData?.recommendationKey,
      numberOfAnalysts: summary.financialData?.numberOfAnalystOpinions,
    },
    // quote().beta is frequently absent on Yahoo's endpoint;
    // defaultKeyStatistics.beta is the reliable source.
    beta: summary.defaultKeyStatistics?.beta,
    dividendCalendar: {
      exDividendDate: summary.calendarEvents?.exDividendDate,
    },
  };
}

export interface DailyClose {
  date: string; // ISO date
  close: number;
}

/** Daily closes for the trailing `days` calendar days, oldest first. */
export async function fetchHistoricalCloses(
  ticker: string,
  days: number
): Promise<DailyClose[]> {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - days * 24 * 60 * 60 * 1000);

  const result = await getYahooClient().chart(ticker, {
    period1,
    period2,
    interval: "1d",
  });

  return result.quotes
    .filter((q): q is typeof q & { close: number } => q.close != null)
    .map((q) => ({
      date: new Date(q.date).toISOString().slice(0, 10),
      close: q.close,
    }));
}

/** Simple moving average over the last `period` closes, or null if short. */
export function simpleMovingAverage(
  closes: DailyClose[],
  period: number
): number | null {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const sum = window.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

export interface ThreeMonthRange {
  high: number;
  low: number;
}

/**
 * High/low over the most recent `tradingDays` closes (default 63, ~3
 * calendar months) -- slices the closes array already fetched for SMA
 * calculation rather than issuing a separate request.
 */
export function computeThreeMonthRange(
  closes: DailyClose[],
  tradingDays = 63
): ThreeMonthRange | null {
  if (closes.length === 0) return null;
  const window = closes.slice(-tradingDays);
  const values = window.map((c) => c.close);
  return { high: Math.max(...values), low: Math.min(...values) };
}

export interface ExpirationChain {
  expirationDate: Date;
  calls: Option["calls"];
  puts: Option["puts"];
}

export interface OptionsChainResult {
  underlyingSymbol: string;
  underlyingPrice: number | undefined;
  marketState: string | undefined;
  expirations: ExpirationChain[];
}

/**
 * Fetches the options chain for every expiration within `maxDays` days.
 * Yahoo's options() endpoint returns one expiration per call, so this
 * makes one call to discover expirationDates + one per matching date.
 */
export async function fetchOptionsChainWithinDays(
  ticker: string,
  maxDays: number
): Promise<OptionsChainResult> {
  const yahooFinance = getYahooClient();
  const base: OptionsResult = await yahooFinance.options(ticker);

  const now = Date.now();
  const cutoff = now + maxDays * 24 * 60 * 60 * 1000;
  const datesInRange = base.expirationDates.filter(
    (d) => d.getTime() >= now && d.getTime() <= cutoff
  );

  const perExpiration = await Promise.all(
    datesInRange.map(async (date) => {
      const result = await yahooFinance.options(ticker, { date });
      const chain = result.options[0];
      return {
        expirationDate: chain?.expirationDate ?? date,
        calls: chain?.calls ?? [],
        puts: chain?.puts ?? [],
      };
    })
  );

  return {
    underlyingSymbol: base.underlyingSymbol,
    underlyingPrice: base.quote?.regularMarketPrice,
    marketState: base.quote?.marketState,
    expirations: perExpiration,
  };
}

export interface NearestExpirationChain {
  underlyingPrice: number | undefined;
  marketState: string | undefined;
  expirationDate: Date;
  calls: Option["calls"];
  puts: Option["puts"];
}

/**
 * Fetches only the nearest expiration's chain (Yahoo's default when no
 * `date` is passed) -- a single request, used where we don't need every
 * expiration within a window (max pain, IV snapshot).
 */
export async function fetchNearestExpirationChain(
  ticker: string
): Promise<NearestExpirationChain> {
  const result = await getYahooClient().options(ticker);
  const chain = result.options[0];

  return {
    underlyingPrice: result.quote?.regularMarketPrice,
    marketState: result.quote?.marketState,
    expirationDate: chain?.expirationDate ?? result.expirationDates[0],
    calls: chain?.calls ?? [],
    puts: chain?.puts ?? [],
  };
}

export function daysToExpiration(expirationDate: Date): number {
  const ms = expirationDate.getTime() - Date.now();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Fetches just the expiration closest to `targetDte` (default 37, the
 * midpoint of the 30-45 DTE band) -- two Yahoo requests (expiration list,
 * then that one chain) instead of fetchOptionsChainWithinDays' N+1. Used
 * where only a single representative chain is needed, e.g. a watchlist
 * card's ATM IV.
 */
export async function fetchTargetExpirationChain(
  ticker: string,
  targetDte = 37
): Promise<NearestExpirationChain> {
  const yahooFinance = getYahooClient();
  const base: OptionsResult = await yahooFinance.options(ticker);

  const now = Date.now();
  const future = base.expirationDates.filter((d) => d.getTime() >= now);
  const candidates = future.length > 0 ? future : base.expirationDates;

  let target = candidates[0];
  let bestDiff = Infinity;
  for (const date of candidates) {
    const diff = Math.abs(daysToExpiration(date) - targetDte);
    if (diff < bestDiff) {
      bestDiff = diff;
      target = date;
    }
  }

  const result = await yahooFinance.options(ticker, { date: target });
  const chain = result.options[0];

  return {
    underlyingPrice: result.quote?.regularMarketPrice,
    marketState: result.quote?.marketState,
    expirationDate: chain?.expirationDate ?? target,
    calls: chain?.calls ?? [],
    puts: chain?.puts ?? [],
  };
}

export interface SearchMatch {
  symbol: string;
  name: string;
  quoteType: string;
}

/** Resolves a company name or partial ticker to real symbols. */
export async function fetchSearchResults(
  query: string,
  limit = 8
): Promise<SearchMatch[]> {
  const result = await getYahooClient().search(query, {
    quotesCount: limit,
    newsCount: 0,
  });

  return result.quotes
    .filter(
      (q): q is typeof q & { isYahooFinance: true; symbol: string } =>
        "isYahooFinance" in q &&
        q.isYahooFinance === true &&
        (q.quoteType === "EQUITY" || q.quoteType === "ETF")
    )
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      quoteType: q.quoteType,
    }));
}
