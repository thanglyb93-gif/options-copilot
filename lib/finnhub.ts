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

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Finnhub request failed: ${response.status} ${response.statusText}`
      );
    }
    return response.json() as Promise<T>;
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
