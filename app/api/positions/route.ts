import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import type { PositionRow, PositionStatus, PositionType } from "@/types/database";
import type { PositionAnalytics, PositionSummary } from "@/types/api";
import { fetchHistoricalCloses, fetchOptionsChainWithinDays, fetchQuote } from "@/lib/yahoo";
import { earningsCooldownFlag } from "@/lib/flags";
import {
  closeSignal,
  decayCurvePosition,
  findCurrentContract,
  itmRiskClassification,
  profitCaptured,
} from "@/lib/position-analytics";

const POSITION_TYPES: PositionType[] = ["covered_call", "cash_secured_put"];
const POSITION_STATUSES: PositionStatus[] = [
  "open",
  "closed",
  "assigned",
  "expired",
];

// Options chain lookups only need to cover expirations within this many
// days -- open positions beyond that just won't find a matching
// expiration (extremely rare for this app's 30-45 DTE target band) and
// fall back to analytics: null rather than erroring.
const MAX_CHAIN_DAYS = 60;
const HISTORICAL_CLOSES_DAYS = 30;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + "T00:00:00Z").getTime();
  const to = new Date(toIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

interface TickerData {
  quote: Awaited<ReturnType<typeof fetchQuote>> | null;
  chain: Awaited<ReturnType<typeof fetchOptionsChainWithinDays>> | null;
  closes: Awaited<ReturnType<typeof fetchHistoricalCloses>>;
}

async function gatherTickerData(ticker: string): Promise<TickerData> {
  const [quote, chain, closes] = await Promise.all([
    fetchQuote(ticker).catch(() => null),
    fetchOptionsChainWithinDays(ticker, MAX_CHAIN_DAYS).catch(() => null),
    fetchHistoricalCloses(ticker, HISTORICAL_CLOSES_DAYS).catch(() => []),
  ]);
  return { quote, chain, closes };
}

function computeAnalytics(position: PositionRow, data: TickerData): PositionAnalytics {
  const today = new Date().toISOString();
  const dte = Math.max(0, daysBetween(today, position.expiration_date));
  const currentUnderlyingPrice = data.quote?.regularMarketPrice ?? null;

  const contract = data.chain
    ? findCurrentContract(data.chain, position.strike, position.expiration_date, position.position_type)
    : null;

  const currentContractValue = contract?.referencePrice ?? null;
  const usingLastPriceFallback = contract?.usingLastPriceFallback ?? false;
  const contractUnreliable = contract?.unreliable ?? true;

  const optionLegPL =
    currentContractValue != null
      ? (position.premium_collected - currentContractValue) * 100 * position.contracts
      : null;

  const stockPL =
    position.position_type === "covered_call" &&
    position.cost_basis != null &&
    position.shares_owned != null &&
    currentUnderlyingPrice != null
      ? (currentUnderlyingPrice - position.cost_basis) * position.shares_owned
      : null;

  const netCoveredPL =
    optionLegPL != null
      ? (position.position_type === "covered_call" ? (stockPL ?? 0) : 0) + optionLegPL
      : null;

  const profitCapturedPct =
    currentContractValue != null ? profitCaptured(position.premium_collected, currentContractValue) : null;

  const decayCurve =
    currentUnderlyingPrice != null && contract?.referencePrice != null
      ? decayCurvePosition(
          position.strike,
          currentUnderlyingPrice,
          // Solving IV from the current reference price would need a per-contract
          // dte, which we already have -- reuse the chain's own reported IV when
          // available, since that's already market-hours-fallback-aware upstream.
          impliedVolFromChain(data, position) ?? 0.4,
          Math.max(1, daysBetween(position.opened_at, position.expiration_date)),
          position.position_type === "covered_call" ? "call" : "put"
        )
      : [];

  const closeSignalResult =
    profitCapturedPct != null
      ? closeSignal(profitCapturedPct, dte, position.position_type)
      : { shouldClose: false, reason: null };

  const isItm =
    currentUnderlyingPrice != null &&
    (position.position_type === "covered_call"
      ? currentUnderlyingPrice > position.strike
      : currentUnderlyingPrice < position.strike);

  const itmResult =
    isItm && currentUnderlyingPrice != null
      ? itmRiskClassification(
          position.strike,
          currentUnderlyingPrice,
          dte,
          data.closes,
          earningsCooldownFlag(data.closes).flagged,
          position.position_type === "covered_call" ? "call" : "put"
        )
      : null;

  return {
    dte,
    currentUnderlyingPrice,
    currentContractValue,
    usingLastPriceFallback,
    contractUnreliable,
    stockPL,
    optionLegPL,
    netCoveredPL,
    profitCapturedPct,
    decayCurve,
    closeSignal: closeSignalResult,
    itmRiskClassification: itmResult,
  };
}

function impliedVolFromChain(data: TickerData, position: PositionRow): number | null {
  if (!data.chain) return null;
  const expiration = data.chain.expirations.find(
    (e) => e.expirationDate.toISOString().slice(0, 10) === position.expiration_date
  );
  if (!expiration) return null;
  const list = position.position_type === "covered_call" ? expiration.calls : expiration.puts;
  const contract = list.find((c) => c.strike === position.strike);
  return contract?.impliedVolatility && contract.impliedVolatility > 0 ? contract.impliedVolatility : null;
}

export async function GET(request: Request) {
  const supabase = getSupabaseRouteClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  if (status && !POSITION_STATUSES.includes(status as PositionStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${POSITION_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  let query = supabase
    .from("positions")
    .select("*")
    .order("opened_at", { ascending: false });

  if (status) {
    query = query.eq("status", status as PositionStatus);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const rows = (data ?? []) as PositionRow[];
  const openRows = rows.filter((r) => r.status === "open");
  const distinctTickers = Array.from(new Set(openRows.map((r) => r.ticker)));

  const tickerDataEntries = await Promise.all(
    distinctTickers.map(async (ticker) => [ticker, await gatherTickerData(ticker)] as const)
  );
  const tickerDataByTicker = new Map(tickerDataEntries);

  const positions: PositionSummary[] = rows.map((row) => {
    const tickerData = tickerDataByTicker.get(row.ticker);
    const analytics = row.status === "open" && tickerData ? computeAnalytics(row, tickerData) : null;

    return {
      id: row.id,
      ticker: row.ticker,
      position_type: row.position_type,
      shares_owned: row.shares_owned,
      cost_basis: row.cost_basis,
      strike: row.strike,
      premium_collected: row.premium_collected,
      expiration_date: row.expiration_date,
      contracts: row.contracts,
      status: row.status,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
      closing_premium: row.closing_premium,
      realized_pl: row.realized_pl,
      analytics,
    };
  });

  return NextResponse.json({ positions });
}

export async function POST(request: Request) {
  const supabase = getSupabaseRouteClient();
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    ticker,
    position_type,
    shares_owned,
    cost_basis,
    strike,
    premium_collected,
    expiration_date,
    contracts,
    opened_at,
  } = body as Record<string, unknown>;

  if (
    typeof ticker !== "string" ||
    typeof position_type !== "string" ||
    !POSITION_TYPES.includes(position_type as PositionType) ||
    typeof strike !== "number" ||
    typeof premium_collected !== "number" ||
    typeof expiration_date !== "string" ||
    typeof contracts !== "number"
  ) {
    return NextResponse.json(
      {
        error:
          "ticker, position_type ('covered_call'|'cash_secured_put'), strike, premium_collected, expiration_date, contracts are required",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("positions")
    .insert({
      ticker: ticker.toUpperCase(),
      position_type: position_type as PositionType,
      shares_owned: typeof shares_owned === "number" ? shares_owned : null,
      cost_basis: typeof cost_basis === "number" ? cost_basis : null,
      strike,
      premium_collected,
      expiration_date,
      contracts,
      ...(typeof opened_at === "string" ? { opened_at } : {}),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ position: data }, { status: 201 });
}
