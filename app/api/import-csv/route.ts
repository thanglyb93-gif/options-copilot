import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import {
  matchRoundTrips,
  parseRobinhoodCsv,
  positionDedupeKey,
  toPositionCandidates,
  type ImportPositionCandidate,
} from "@/lib/csv-import";

/**
 * Phase 37 -- parses an uploaded Robinhood activity CSV, matches STO
 * opens to their BTC/OASGN/OEXP closes (FIFO), and bulk-inserts the
 * resulting closed/assigned/expired positions rows. Idempotent: rows
 * that would duplicate an already-logged position (same ticker + strike
 * + expiration + opened_at date) are skipped, so re-running this as the
 * user's export grows over time never double-inserts.
 *
 * `commit` (a form field, "true"/"false") gates whether this actually
 * writes: without it (or "false"), this is a dry-run preview only --
 * parses, matches, and checks for duplicates, but inserts nothing. The
 * UI re-POSTs the identical file with commit=true once the user
 * confirms the preview; no server-side state is kept between the two
 * calls.
 */
export async function POST(request: Request) {
  const supabase = getSupabaseRouteClient();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field (the CSV to import)" }, { status: 400 });
  }
  const commit = formData.get("commit") === "true";

  const fileContent = await file.text();
  const { rows, skippedRows } = parseRobinhoodCsv(fileContent);
  const { roundTrips, unmatchedOpens, unmatchedCloses } = matchRoundTrips(rows);
  const candidates = toPositionCandidates(roundTrips);

  const { data: existingRows, error: readError } = await supabase
    .from("positions")
    .select("ticker, strike, expiration_date, opened_at");

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 502 });
  }

  const existingKeys = new Set((existingRows ?? []).map((r) => positionDedupeKey(r)));

  const toInsert: ImportPositionCandidate[] = [];
  const duplicates: ImportPositionCandidate[] = [];
  for (const candidate of candidates) {
    if (existingKeys.has(positionDedupeKey(candidate))) {
      duplicates.push(candidate);
    } else {
      toInsert.push(candidate);
    }
  }

  let insertedCount = 0;
  if (commit && toInsert.length > 0) {
    const { error: insertError, count } = await supabase
      .from("positions")
      .insert(toInsert, { count: "exact" });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 502 });
    }
    insertedCount = count ?? toInsert.length;
  }

  const summarize = (c: ImportPositionCandidate) => ({
    ticker: c.ticker,
    positionType: c.position_type,
    strike: c.strike,
    expirationDate: c.expiration_date,
    openedAt: c.opened_at.slice(0, 10),
    closedAt: c.closed_at.slice(0, 10),
    status: c.status,
    premiumCollected: c.premium_collected,
    closingPremium: c.closing_premium,
    realizedPl: c.realized_pl,
    contracts: c.contracts,
  });

  const summarizeUnmatched = (u: { row: { rowNumber: number; description: string; transCode: string; activityDate: string }; unmatchedQuantity: number }) => ({
    rowNumber: u.row.rowNumber,
    description: u.row.description,
    transCode: u.row.transCode,
    activityDate: u.row.activityDate,
    unmatchedQuantity: u.unmatchedQuantity,
  });

  return NextResponse.json({
    totalRowsParsed: rows.length,
    skippedRows,
    roundTripsMatched: roundTrips.length,
    unmatchedOpens: unmatchedOpens.map(summarizeUnmatched),
    unmatchedCloses: unmatchedCloses.map(summarizeUnmatched),
    candidatesTotal: candidates.length,
    duplicatesSkipped: duplicates.length,
    duplicates: duplicates.map(summarize),
    toInsert: toInsert.map(summarize),
    committed: commit,
    insertedCount,
  });
}
