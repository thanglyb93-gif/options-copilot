/**
 * Typed Finnhub REST client wrapper. Nothing in this app calls Finnhub yet
 * (phase 1 is foundation only) -- this exists so later phases have a typed,
 * self-contained client to import from API routes.
 */

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

export interface FinnhubQuote {
  c: number; // current price
  d: number | null; // change
  dp: number | null; // percent change
  h: number; // high of the day
  l: number; // low of the day
  o: number; // open of the day
  pc: number; // previous close
  t: number; // unix timestamp
}

export interface FinnhubEarningsEvent {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: string;
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  symbol: string;
  year: number;
}

export interface FinnhubEarningsCalendarResponse {
  earningsCalendar: FinnhubEarningsEvent[];
}

export interface FinnhubNewsItem {
  category: string;
  datetime: number; // unix seconds
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

/**
 * Finnhub's free tier caps API calls per minute. A single ticker page only
 * ever fires 1-2 calls at once, so this never mattered until Phase 41's
 * Ranking view started firing 2 calls/ticker across an entire watchlist
 * (e.g. 50 calls for a 25-ticker watchlist) within a few seconds, well
 * past that budget and returning 429s.
 *
 * Two layers handle this without serializing every call end-to-end (which
 * blew the batch out to 100+ seconds when tried): dispatch pacing spaces
 * out when requests are *sent* (not when they finish, so in-flight latency
 * overlaps instead of stacking), and a 429-specific retry with backoff
 * mops up whatever the pacing doesn't prevent -- the real per-minute limit
 * isn't published precisely, so a reactive safety net is more robust than
 * guessing a conservative fixed interval.
 */
const MIN_DISPATCH_INTERVAL_MS = 250;
let nextAllowedDispatch = 0;
let dispatchChain: Promise<void> = Promise.resolve();

function paceDispatch(): Promise<void> {
  const scheduled = dispatchChain.then(() => {
    const now = Date.now();
    const dispatchAt = Math.max(now, nextAllowedDispatch);
    nextAllowedDispatch = dispatchAt + MIN_DISPATCH_INTERVAL_MS;
    const waitMs = dispatchAt - now;
    return waitMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, waitMs)) : undefined;
  });
  dispatchChain = scheduled;
  return scheduled;
}

const MAX_429_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FinnhubClient {
  private readonly apiKey: string;

  constructor(apiKey = process.env.FINNHUB_API_KEY) {
    if (!apiKey) {
      throw new Error("FINNHUB_API_KEY is not set.");
    }
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${FINNHUB_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("token", this.apiKey);

    for (let attempt = 0; ; attempt++) {
      await paceDispatch();
      const response = await fetch(url.toString());
      if (response.ok) {
        return response.json() as Promise<T>;
      }
      if (response.status === 429 && attempt < MAX_429_RETRIES) {
        const retryAfterSeconds = Number(response.headers.get("Retry-After"));
        const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : RETRY_BASE_DELAY_MS * 2 ** attempt;
        await sleep(delay);
        continue;
      }
      throw new Error(
        `Finnhub request failed: ${response.status} ${response.statusText}`
      );
    }
  }

  async getQuote(symbol: string): Promise<FinnhubQuote> {
    return this.request<FinnhubQuote>("/quote", { symbol });
  }

  async getEarningsCalendar(
    symbol: string,
    from: string,
    to: string
  ): Promise<FinnhubEarningsCalendarResponse> {
    return this.request<FinnhubEarningsCalendarResponse>("/calendar/earnings", {
      symbol,
      from,
      to,
    });
  }

  async getCompanyNews(
    symbol: string,
    from: string,
    to: string
  ): Promise<FinnhubNewsItem[]> {
    return this.request<FinnhubNewsItem[]>("/company-news", { symbol, from, to });
  }

  async getGeneralNews(category = "general"): Promise<FinnhubNewsItem[]> {
    return this.request<FinnhubNewsItem[]>("/news", { category });
  }
}

/**
 * Lazily constructed singleton so importing this module never throws when
 * FINNHUB_API_KEY is unset -- the app shell must still render before
 * Finnhub is wired up.
 */
let client: FinnhubClient | null = null;

export function getFinnhubClient(): FinnhubClient {
  if (!client) {
    client = new FinnhubClient();
  }
  return client;
}

/**
 * Macro/general market headlines (Fed commentary, inflation and jobs data,
 * major M&A, geopolitical developments, notable S&P 500 earnings, etc).
 * Finnhub's general-news endpoint doesn't take a date range or limit --
 * this sorts newest-first and caps to `limit` so callers get a
 * predictable, healthy volume of the most recent items.
 */
export async function fetchGeneralMarketNews(limit = 50): Promise<FinnhubNewsItem[]> {
  const news = await getFinnhubClient().getGeneralNews();
  return news.slice().sort((a, b) => b.datetime - a.datetime).slice(0, limit);
}
