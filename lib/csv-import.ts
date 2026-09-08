/**
 * Phase 37 -- imports historical options trade history from a Robinhood
 * activity CSV export into the `positions` table as closed/assigned/
 * expired records. A genuine prerequisite for any efficiency or
 * backtesting analysis against real trading history: this app otherwise
 * only sees whatever's been manually logged since it was built. Pure --
 * no API/DB calls; the API route does the Supabase duplicate-check and
 * insert.
 *
 * CSV columns: Activity Date, Process Date, Settle Date, Instrument,
 * Description, Trans Code, Quantity, Price, Amount. Trans codes handled:
 * STO (sell to open), BTC (buy to close), OASGN (assigned), OEXP
 * (expired worthless). Option descriptions: "{TICKER} {M}/{D}/{YYYY}
 * {Call|Put} ${STRIKE}", OEXP prefixed "Option Expiration for ".
 */

import type { PositionStatus, PositionType } from "@/types/database";

// ---------------------------------------------------------------------------
// Part 1 -- RFC4180 CSV parsing. Naive line-splitting breaks on
// Robinhood's quoted multiline cells (company name + CUSIP spanning 2
// lines within one quoted field), which is exactly what this state
// machine handles correctly: a newline or comma inside an open quote is
// just field content, not a delimiter.
// ---------------------------------------------------------------------------

function parseCsvTable(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Part 2 -- field parsing helpers
// ---------------------------------------------------------------------------

/** "M/D/YYYY" -> "YYYY-MM-DD". Null if it doesn't match. */
function parseUsDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, m, d, y] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Strips $/commas/parens (parens = negative, Robinhood's debit convention). Absolute-valued for Quantity via the caller. */
function parseMoney(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[()$,]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

/** Quantity is always a magnitude -- direction comes from Trans Code, not sign. */
function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(value) ? Math.abs(value) : null;
}

export type OptionType = "call" | "put";

export interface ParsedOptionDescription {
  ticker: string;
  expirationDate: string; // ISO "YYYY-MM-DD"
  optionType: OptionType;
  strike: number;
}

/** Matches "{TICKER} {M}/{D}/{YYYY} {Call|Put} ${STRIKE}", with an optional "Option Expiration for " prefix (OEXP rows). */
const OPTION_DESCRIPTION_RE =
  /^(?:Option Expiration for\s+)?([A-Za-z.]+)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(Call|Put)\s+\$([\d,.]+)/i;

export function parseOptionDescription(description: string): ParsedOptionDescription | null {
  const match = description.trim().match(OPTION_DESCRIPTION_RE);
  if (!match) return null;
  const [, ticker, month, day, year, type, strikeRaw] = match;
  const strike = Number(strikeRaw.replace(/,/g, ""));
  if (!Number.isFinite(strike)) return null;
  return {
    ticker: ticker.toUpperCase(),
    expirationDate: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    optionType: type.toLowerCase() === "call" ? "call" : "put",
    strike,
  };
}

// ---------------------------------------------------------------------------
// Part 3 -- full-file parse
// ---------------------------------------------------------------------------

export const RELEVANT_TRANS_CODES = ["STO", "BTC", "OASGN", "OEXP"] as const;
export type RelevantTransCode = (typeof RELEVANT_TRANS_CODES)[number];

export interface ParsedRobinhoodRow {
  /** 1-based row number as it appears in the file (header = row 1) -- for error reporting, not stored. */
  rowNumber: number;
  activityDate: string; // ISO "YYYY-MM-DD"
  processDate: string | null;
  settleDate: string | null;
  instrument: string;
  description: string;
  transCode: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  /** Null for non-option rows (stock Buy/Sell) or an option description that didn't match the expected pattern. */
  option: ParsedOptionDescription | null;
}

export interface SkippedRow {
  rowNumber: number;
  raw: string[];
  reason: string;
}

export interface CsvParseResult {
  rows: ParsedRobinhoodRow[];
  skippedRows: SkippedRow[];
}

/**
 * Parses the full file into structured rows. Skips (rather than fails
 * on) any row whose column count doesn't match the header -- Robinhood
 * exports can end with a malformed trailing disclaimer row or two.
 */
export function parseRobinhoodCsv(fileContent: string): CsvParseResult {
  const table = parseCsvTable(fileContent);
  const rows: ParsedRobinhoodRow[] = [];
  const skippedRows: SkippedRow[] = [];

  if (table.length === 0) return { rows, skippedRows };

  const expectedColumnCount = table[0].length;

  for (let i = 1; i < table.length; i++) {
    const raw = table[i];
    const rowNumber = i + 1;

    // A single trailing empty cell is just end-of-file noise from a final newline, not a real row.
    if (raw.length === 1 && raw[0].trim() === "") continue;

    if (raw.length !== expectedColumnCount) {
      skippedRows.push({
        rowNumber,
        raw,
        reason: `Expected ${expectedColumnCount} columns (matching the header), found ${raw.length} -- likely a trailing disclaimer/footer row.`,
      });
      continue;
    }

    const [activityDateRaw, processDateRaw, settleDateRaw, instrument, description, transCode, quantityRaw, priceRaw, amountRaw] =
      raw;

    const activityDate = parseUsDate(activityDateRaw);
    if (!activityDate) {
      skippedRows.push({ rowNumber, raw, reason: `Could not parse Activity Date "${activityDateRaw}".` });
      continue;
    }

    rows.push({
      rowNumber,
      activityDate,
      processDate: parseUsDate(processDateRaw),
      settleDate: parseUsDate(settleDateRaw),
      instrument: instrument.trim(),
      description: description.trim(),
      transCode: transCode.trim(),
      quantity: parseQuantity(quantityRaw),
      price: parseMoney(priceRaw),
      amount: parseMoney(amountRaw),
      option: parseOptionDescription(description),
    });
  }

  return { rows, skippedRows };
}

// ---------------------------------------------------------------------------
// Part 4 -- FIFO round-trip matching. STO opens a lot; BTC/OASGN/OEXP
// closes it, oldest lot first. Quantity is matched at the contract level
// (not assumed 1 row = 1 round trip), splitting a lot across multiple
// partial closes or aggregating multiple lots into one close, whichever
// the real data requires.
// ---------------------------------------------------------------------------

export type RoundTripOutcome = "closed" | "assigned" | "expired";

export interface MatchedRoundTrip {
  ticker: string;
  optionType: OptionType;
  strike: number;
  expirationDate: string;
  contracts: number;
  openedAt: string; // ISO date, the STO's Activity Date
  closedAt: string; // ISO date, the closing event's Activity Date
  /** Per-share/per-contract-unit -- same convention as positions.premium_collected. */
  premiumCollectedPerShare: number;
  /** Per-share buyback price. Null for OASGN/OEXP (no premium paid to close). */
  closingPremiumPerShare: number | null;
  outcome: RoundTripOutcome;
  openRowNumber: number;
  closeRowNumber: number;
}

function contractKey(o: ParsedOptionDescription): string {
  return `${o.ticker}|${o.expirationDate}|${o.optionType}|${o.strike}`;
}

function outcomeForTransCode(transCode: string): RoundTripOutcome | null {
  if (transCode === "BTC") return "closed";
  if (transCode === "OASGN") return "assigned";
  if (transCode === "OEXP") return "expired";
  return null;
}

export interface MatchResult {
  roundTrips: MatchedRoundTrip[];
  /** STO rows (or the unconsumed remainder of one) with no matching close found in this export -- the position is presumably still open in the brokerage, correctly left out of a "closed positions" import. */
  unmatchedOpens: { row: ParsedRobinhoodRow; unmatchedQuantity: number }[];
  /** Close events (or the unconsumed remainder of one) with no open lot to match against -- e.g. a position opened before this export's date range. */
  unmatchedCloses: { row: ParsedRobinhoodRow; unmatchedQuantity: number }[];
}

export function matchRoundTrips(rows: ParsedRobinhoodRow[]): MatchResult {
  const byContract = new Map<string, { opens: ParsedRobinhoodRow[]; closes: ParsedRobinhoodRow[] }>();

  for (const row of rows) {
    if (!row.option || row.quantity == null) continue;
    if (row.transCode === "STO") {
      const bucket = byContract.get(contractKey(row.option)) ?? { opens: [], closes: [] };
      bucket.opens.push(row);
      byContract.set(contractKey(row.option), bucket);
    } else if (outcomeForTransCode(row.transCode) != null) {
      const bucket = byContract.get(contractKey(row.option)) ?? { opens: [], closes: [] };
      bucket.closes.push(row);
      byContract.set(contractKey(row.option), bucket);
    }
  }

  const roundTrips: MatchedRoundTrip[] = [];
  const unmatchedOpens: MatchResult["unmatchedOpens"] = [];
  const unmatchedCloses: MatchResult["unmatchedCloses"] = [];

  for (const bucket of Array.from(byContract.values())) {
    const opens = [...bucket.opens].sort((a, b) => a.activityDate.localeCompare(b.activityDate));
    const closes = [...bucket.closes].sort((a, b) => a.activityDate.localeCompare(b.activityDate));

    const lots = opens.map((row) => ({ row, remaining: row.quantity! }));
    let lotIndex = 0;

    for (const closeRow of closes) {
      let remainingToClose = closeRow.quantity!;
      const outcome = outcomeForTransCode(closeRow.transCode)!;

      while (remainingToClose > 0 && lotIndex < lots.length) {
        const lot = lots[lotIndex];
        if (lot.remaining <= 0) {
          lotIndex++;
          continue;
        }

        const matched = Math.min(lot.remaining, remainingToClose);
        roundTrips.push({
          ticker: lot.row.option!.ticker,
          optionType: lot.row.option!.optionType,
          strike: lot.row.option!.strike,
          expirationDate: lot.row.option!.expirationDate,
          contracts: matched,
          openedAt: lot.row.activityDate,
          closedAt: closeRow.activityDate,
          premiumCollectedPerShare: lot.row.price ?? 0,
          closingPremiumPerShare: closeRow.transCode === "BTC" ? (closeRow.price ?? 0) : null,
          outcome,
          openRowNumber: lot.row.rowNumber,
          closeRowNumber: closeRow.rowNumber,
        });

        lot.remaining -= matched;
        remainingToClose -= matched;
        if (lot.remaining === 0) lotIndex++;
      }

      if (remainingToClose > 0) {
        unmatchedCloses.push({ row: closeRow, unmatchedQuantity: remainingToClose });
      }
    }

    for (const lot of lots) {
      if (lot.remaining > 0) unmatchedOpens.push({ row: lot.row, unmatchedQuantity: lot.remaining });
    }
  }

  return { roundTrips, unmatchedOpens, unmatchedCloses };
}

// ---------------------------------------------------------------------------
// Part 5 -- round trips -> positions table rows
// ---------------------------------------------------------------------------

export interface ImportPositionCandidate {
  ticker: string;
  position_type: PositionType;
  strike: number;
  premium_collected: number;
  expiration_date: string;
  contracts: number;
  opened_at: string; // ISO datetime
  closed_at: string; // ISO datetime
  closing_premium: number | null;
  realized_pl: number;
  status: PositionStatus;
  /**
   * Deliberately null, never guessed. For an assigned/closed CALL, the
   * shares had to already be owned before the STO to make it a covered
   * call -- their original acquisition (and true cost basis) predates
   * and is entirely outside this options-activity export. Reconstructing
   * a fake cost basis here would be worse than admitting it's unknown;
   * the user can fill it in later via PATCH /api/positions/[id] if they
   * know it.
   */
  shares_owned: null;
  cost_basis: null;
}

/**
 * Converts matched round trips into positions-table-shaped rows.
 * Realized P/L mirrors app/api/positions/[id]/close's own formula
 * exactly (option leg only, since cost basis/shares are unknown here --
 * the same "0 stock leg when cost basis isn't known" behavior that route
 * already has, not a new convention): for a closed round trip,
 * (premium collected − closing premium) × 100 × contracts; for an
 * assigned or expired one, the full premium × 100 × contracts is kept.
 */
export function toPositionCandidates(roundTrips: MatchedRoundTrip[]): ImportPositionCandidate[] {
  return roundTrips.map((rt) => {
    const optionLegPL =
      rt.outcome === "closed"
        ? (rt.premiumCollectedPerShare - (rt.closingPremiumPerShare ?? 0)) * 100 * rt.contracts
        : rt.premiumCollectedPerShare * 100 * rt.contracts;

    return {
      ticker: rt.ticker,
      position_type: rt.optionType === "call" ? "covered_call" : "cash_secured_put",
      strike: rt.strike,
      premium_collected: rt.premiumCollectedPerShare,
      expiration_date: rt.expirationDate,
      contracts: rt.contracts,
      opened_at: `${rt.openedAt}T00:00:00Z`,
      closed_at: `${rt.closedAt}T00:00:00Z`,
      closing_premium: rt.closingPremiumPerShare,
      realized_pl: optionLegPL,
      status: rt.outcome,
      shares_owned: null,
      cost_basis: null,
    };
  });
}

/** Idempotency key -- same fields the import's duplicate check compares against already-logged rows. */
export function positionDedupeKey(p: {
  ticker: string;
  strike: number;
  expiration_date: string;
  opened_at: string;
}): string {
  return `${p.ticker}|${p.strike}|${p.expiration_date}|${p.opened_at.slice(0, 10)}`;
}
