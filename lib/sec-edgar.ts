/**
 * SEC EDGAR Form 4 (insider transaction) reads -- free, no API key, but
 * SEC requires a descriptive User-Agent identifying the requester on
 * every request (https://www.sec.gov/os/webmaster-faq#developers) and
 * asks for no more than ~10 requests/second. Nothing here is cached in
 * memory beyond the ticker->CIK map (see below); the per-ticker
 * Form 4 summary itself is cached in Supabase by the API route
 * (lib/insider-service.ts), same TTL-cache pattern as briefings.
 */

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";

function userAgent(): string {
  const email = process.env.INSIDER_EDGAR_CONTACT_EMAIL;
  if (!email) {
    throw new Error(
      "INSIDER_EDGAR_CONTACT_EMAIL is not set -- required in the User-Agent on every SEC EDGAR request, or SEC will block it."
    );
  }
  return `options-copilot research-tool (${email})`;
}

async function secFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent(), "Accept-Encoding": "gzip, deflate" },
    // SEC's own data changes at most daily for this use case; never serve
    // a stale Next.js Data Cache entry silently (same reasoning as
    // lib/supabase.ts and lib/yahoo.ts's no-store fetch opt-outs).
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`SEC EDGAR request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimum gap between sequential SEC requests -- keeps this well under SEC's ~10 req/sec guidance. */
const SEC_REQUEST_GAP_MS = 120;

// ---------------------------------------------------------------------------
// Ticker -> CIK resolution
// ---------------------------------------------------------------------------

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

/** Module-level cache -- reset on cold start, refreshed at most once/day within a warm process. Never refetched per-request. */
let cikMapCache: Map<string, string> | null = null;
let cikMapFetchedAt = 0;
const CIK_MAP_TTL_MS = 24 * 60 * 60 * 1000;

async function loadCikMap(): Promise<Map<string, string>> {
  if (cikMapCache && Date.now() - cikMapFetchedAt < CIK_MAP_TTL_MS) {
    return cikMapCache;
  }

  const res = await secFetch(`${SEC_BASE}/files/company_tickers.json`);
  const raw = (await res.json()) as Record<string, CompanyTickerEntry>;

  const map = new Map<string, string>();
  for (const entry of Object.values(raw)) {
    map.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, "0"));
  }

  cikMapCache = map;
  cikMapFetchedAt = Date.now();
  return map;
}

/** Resolves a ticker to its 10-digit zero-padded CIK, or null if SEC has no matching entry. */
export async function resolveCik(ticker: string): Promise<string | null> {
  const map = await loadCikMap();
  return map.get(ticker.toUpperCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Form 4 filings -> individual open-market transactions
// ---------------------------------------------------------------------------

export type InsiderTransactionCode = "P" | "S";

export interface InsiderTransaction {
  insiderName: string;
  /** e.g. "Director, CEO" -- built from the filing's isDirector/isOfficer/isTenPercentOwner + officerTitle flags. */
  role: string;
  code: InsiderTransactionCode;
  shares: number;
  pricePerShare: number;
  valueUsd: number;
  transactionDate: string; // YYYY-MM-DD
}

interface SecSubmissionsResponse {
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

function extractDirectTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return match ? match[1].trim() : null;
}

function extractNestedValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>\\s*<value>([^<]*)</value>`));
  return match ? match[1].trim() : null;
}

/**
 * Builds a plain-language role string from a Form 4's reportingOwnerRelationship
 * flags -- the standard set every ownershipDocument XML carries. Many
 * filings put "See Remarks" in officerTitle and the real title in the
 * document's free-text <remarks> field instead (confirmed against a
 * real PLTR filing) -- this falls back to parsing that pattern rather
 * than showing the unhelpful literal placeholder.
 */
function extractInsiderRole(xml: string): { name: string; role: string } {
  const name = extractDirectTag(xml, "rptOwnerName") ?? "Unknown insider";

  const isDirector = extractDirectTag(xml, "isDirector") === "1";
  const isOfficer = extractDirectTag(xml, "isOfficer") === "1";
  const isTenPercentOwner = extractDirectTag(xml, "isTenPercentOwner") === "1";
  let officerTitle = extractDirectTag(xml, "officerTitle");

  if (officerTitle && /see remarks/i.test(officerTitle)) {
    const remarks = extractDirectTag(xml, "remarks");
    const remarksTitle = remarks?.match(/officer title:\s*([^.]+)\./i);
    officerTitle = remarksTitle ? remarksTitle[1].trim() : null;
  }

  const parts: string[] = [];
  if (isDirector) parts.push("Director");
  if (isOfficer) parts.push(officerTitle && officerTitle.length > 0 ? officerTitle : "Officer");
  if (isTenPercentOwner) parts.push("10% Owner");

  return { name, role: parts.length > 0 ? parts.join(", ") : "Reporting person" };
}

/**
 * Parses one Form 4 ownershipDocument XML into its open-market (P/S)
 * non-derivative transactions -- grants, awards, option exercises, gifts,
 * and tax-withholding dispositions (codes other than P/S) are excluded
 * per the brief, since only open-market buys/sells reflect real
 * conviction. Lightweight regex-based extraction rather than a full XML
 * parser dependency -- SEC's ownershipDocument schema is small, flat,
 * and has been stable for two decades.
 */
function parseForm4Xml(xml: string): InsiderTransaction[] {
  const { name, role } = extractInsiderRole(xml);

  const transactionBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) ?? [];

  const transactions: InsiderTransaction[] = [];
  for (const block of transactionBlocks) {
    const code = extractDirectTag(block, "transactionCode");
    if (code !== "P" && code !== "S") continue;

    const dateStr = extractNestedValue(block, "transactionDate");
    const sharesStr = extractNestedValue(block, "transactionShares");
    const priceStr = extractNestedValue(block, "transactionPricePerShare");
    if (!dateStr || !sharesStr || !priceStr) continue;

    const shares = Number(sharesStr);
    const pricePerShare = Number(priceStr);
    if (!Number.isFinite(shares) || !Number.isFinite(pricePerShare) || shares <= 0) continue;

    transactions.push({
      insiderName: name,
      role,
      code,
      shares,
      pricePerShare,
      valueUsd: shares * pricePerShare,
      transactionDate: dateStr,
    });
  }

  return transactions;
}

/**
 * Fetches every Form 4 filed for `cik` since `sinceDate` (YYYY-MM-DD) and
 * returns their open-market (P/S) transactions, most recent first. Reads
 * the submissions index once, then fetches each matching filing's XML
 * document sequentially with a small throttling gap (SEC_REQUEST_GAP_MS)
 * to stay well under SEC's ~10 req/sec guidance -- a ticker typically has
 * only a handful of Form 4s in a 30-day window, so sequential is fine.
 */
export async function fetchRecentForm4Filings(cik: string, sinceDate: string): Promise<InsiderTransaction[]> {
  const res = await secFetch(`${SEC_DATA_BASE}/submissions/CIK${cik}.json`);
  const data = (await res.json()) as SecSubmissionsResponse;
  const recent = data.filings.recent;

  const matchingIndices: number[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] === "4" && recent.filingDate[i] >= sinceDate) {
      matchingIndices.push(i);
    }
  }

  const cikNumeric = String(Number(cik)); // Archives path uses the CIK without leading zeros.
  const allTransactions: InsiderTransaction[] = [];

  for (let n = 0; n < matchingIndices.length; n++) {
    const i = matchingIndices[n];
    const accessionNoDashes = recent.accessionNumber[i].replace(/-/g, "");
    // SEC's own `primaryDocument` field frequently points at the
    // XSLT-rendered HTML *viewer* path (e.g. "xslF345X06/wk-form4_...
    // .xml") rather than the raw machine-readable XML -- confirmed via a
    // real filing where fetching that path returned styled HTML with no
    // parseable <transactionCode> tags at all. The real raw XML sits
    // under the same filename directly in the accession root, so this
    // strips any viewer subfolder and refetches from there.
    const rawDocFilename = recent.primaryDocument[i].split("/").pop();
    const docUrl = `${SEC_BASE}/Archives/edgar/data/${cikNumeric}/${accessionNoDashes}/${rawDocFilename}`;

    try {
      const docRes = await secFetch(docUrl);
      const xml = await docRes.text();
      allTransactions.push(...parseForm4Xml(xml));
    } catch {
      // One malformed/unreachable filing shouldn't drop every other one --
      // best-effort aggregation, same convention as the peer-fetch
      // failures in app/api/screener.
    }

    if (n < matchingIndices.length - 1) {
      await sleep(SEC_REQUEST_GAP_MS);
    }
  }

  return allTransactions.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
}

// ---------------------------------------------------------------------------
// Aggregated summary -- what the API route/UI actually consume
// ---------------------------------------------------------------------------

export const INSIDER_ACTIVITY_WINDOW_DAYS = 30;
/** How many individual transactions to surface for display, most recent first. */
export const RECENT_TRANSACTIONS_DISPLAY_COUNT = 5;

export interface InsiderActivitySummary {
  ticker: string;
  windowDays: number;
  purchaseCount: number;
  saleCount: number;
  /** Sum($ bought) - sum($ sold) over the window -- positive means net buying. */
  netValueUsd: number;
  totalBoughtUsd: number;
  totalSoldUsd: number;
  /** Most recent RECENT_TRANSACTIONS_DISPLAY_COUNT transactions, newest first. */
  recentTransactions: InsiderTransaction[];
}

/**
 * Resolves the ticker's CIK and aggregates its last INSIDER_ACTIVITY_WINDOW_DAYS
 * days of open-market Form 4 activity. Returns null when SEC has no CIK
 * for this ticker (e.g. it isn't a US-listed reporting company) --
 * distinct from a real zero-activity result, which the caller surfaces
 * as "no Form 4 activity" rather than an error.
 */
export async function getInsiderActivitySummary(ticker: string): Promise<InsiderActivitySummary | null> {
  const cik = await resolveCik(ticker);
  if (!cik) return null;

  const sinceDate = new Date(Date.now() - INSIDER_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const transactions = await fetchRecentForm4Filings(cik, sinceDate);

  const purchases = transactions.filter((t) => t.code === "P");
  const sales = transactions.filter((t) => t.code === "S");
  const totalBoughtUsd = purchases.reduce((sum, t) => sum + t.valueUsd, 0);
  const totalSoldUsd = sales.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    ticker: ticker.toUpperCase(),
    windowDays: INSIDER_ACTIVITY_WINDOW_DAYS,
    purchaseCount: purchases.length,
    saleCount: sales.length,
    netValueUsd: totalBoughtUsd - totalSoldUsd,
    totalBoughtUsd,
    totalSoldUsd,
    recentTransactions: transactions.slice(0, RECENT_TRANSACTIONS_DISPLAY_COUNT),
  };
}
