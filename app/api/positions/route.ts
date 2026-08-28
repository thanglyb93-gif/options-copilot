import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import type { PositionRow, PositionStatus, PositionType } from "@/types/database";
import type { PortfolioSummary, PositionAnalytics, PositionSummary } from "@/types/api";
import { fetchHistoricalCloses, fetchOptionsChainWithinDays, fetchQuote, fetchQuoteSummaryExtras } from "@/lib/yahoo";
import { earningsCooldownFlag } from "@/lib/flags";
import {
  assignmentOpportunityCost,
  closeSignal,
  findCurrentContract,
  generateProfitHistory,
  itmRiskClassification,
  maxProfitForPosition,
  profitCaptured,
  todayMarkerForPosition,
} from "@/lib/position-analytics";
import {
  betaWeightedDelta,
  MIN_OPEN_POSITIONS_FOR_PORTFOLIO_SUMMARY,
  type PortfolioDeltaPositionInput,
} from "@/lib/portfolio-analytics";

/** Default IV fallback when a position's own contract IV can't be read -- same fallback used for the decay curve. */
const DEFAULT_IV_FALLBACK = 0.4;

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
// Wide enough to comfortably cover a position's opened_at date for this
// app's 30-45 DTE target band (plus buffer) -- the profit trajectory
// needs the actual entry-day close, not just a recent window.
const HISTORICAL_CLOSES_DAYS = 60;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + "T00:00:00Z").getTime();
  const to = new Date(toIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

interface TickerData {
  quote: Awaited<ReturnType<typeof fetchQuote>> | null;
  chain: Awaited<ReturnType<typeof fetchOptionsChainWithinDays>> | null;
  closes: Awaited<ReturnType<typeof fetchHistoricalCloses>>;
  /**
   * quote.beta is frequently absent on Yahoo's endpoint (see
   * /api/quote's own comment on this) -- defaultKeyStatistics.beta via
   * quoteSummary is the reliable source, so that's tried first here too.
   */
  beta: number | null;
}

async function gatherTickerData(ticker: string): Promise<TickerData> {
  const [quote, chain, closes, extras] = await Promise.all([
    fetchQuote(ticker).catch(() => null),
    fetchOptionsChainWithinDays(ticker, MAX_CHAIN_DAYS).catch(() => null),
    fetchHistoricalCloses(ticker, HISTORICAL_CLOSES_DAYS).catch(() => []),
    fetchQuoteSummaryExtras(ticker).catch(() => null),
  ]);
  const beta = extras?.beta ?? quote?.beta ?? null;
  return { quote, chain, closes, beta };
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

  const totalDte = Math.max(1, daysBetween(position.opened_at, position.expiration_date));
  // Same IV source the old decay curve used -- see generateProfitHistory's
  // doc comment on why this stands in for a true historical entry-time IV.
  const entryIv = impliedVolFromChain(data, position) ?? DEFAULT_IV_FALLBACK;

  const maxProfit = maxProfitForPosition(
    position.position_type,
    position.strike,
    position.premium_collected,
    position.contracts,
    position.cost_basis,
    position.shares_owned
  );

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

  const assignmentOpportunityCostResult =
    itmResult != null && currentUnderlyingPrice != null && currentContractValue != null
      ? assignmentOpportunityCost(
          position.position_type,
          position.strike,
          position.premium_collected,
          position.contracts,
          position.cost_basis,
          position.shares_owned,
          currentUnderlyingPrice,
          currentContractValue,
          itmResult.breachPct
        )
      : null;

  const daysElapsed = daysBetween(position.opened_at, today);
  const todayMarker = todayMarkerForPosition(
    daysElapsed,
    position.position_type,
    netCoveredPL,
    optionLegPL
  );

  const profitHistory =
    todayMarker != null && currentUnderlyingPrice != null
      ? generateProfitHistory({
          strike: position.strike,
          entryIv,
          totalDte,
          daysElapsed,
          premiumCollected: position.premium_collected,
          contracts: position.contracts,
          positionType: position.position_type,
          costBasis: position.cost_basis,
          sharesOwned: position.shares_owned,
          closes: data.closes,
          openedAtIso: position.opened_at,
          currentPrice: currentUnderlyingPrice,
          todayProfitDollars: todayMarker.profitDollars,
        })
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
    profitHistory,
    todayMarker,
    maxProfit,
    closeSignal: closeSignalResult,
    itmRiskClassification: itmResult,
    assignmentOpportunityCost: assignmentOpportunityCostResult,
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
  const needsPortfolioSummary = openRows.length >= MIN_OPEN_POSITIONS_FOR_PORTFOLIO_SUMMARY;

  const [tickerDataEntries, spyQuote] = await Promise.all([
    Promise.all(distinctTickers.map(async (ticker) => [ticker, await gatherTickerData(ticker)] as const)),
    // Only fetched when it could actually matter -- below the 2-position
    // threshold a portfolio summary isn't shown at all, so there's no
    // reason to spend an extra Yahoo call on SPY's quote.
    needsPortfolioSummary ? fetchQuote("SPY").catch(() => null) : Promise.resolve(null),
  ]);
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

  // Below the 2-open-position threshold this stays null -- not just an
  // empty/zero summary, genuinely absent, since it's not a meaningful
  // number with only one position.
  let portfolioSummary: PortfolioSummary | null = null;

  if (needsPortfolioSummary && spyQuote?.regularMarketPrice != null) {
    const spyPrice = spyQuote.regularMarketPrice;
    const deltaInputs: PortfolioDeltaPositionInput[] = [];

    for (const row of openRows) {
      const tickerData = tickerDataByTicker.get(row.ticker);
      const underlyingPrice = tickerData?.quote?.regularMarketPrice ?? null;
      const beta = tickerData?.beta ?? null;
      // Skip rather than guess -- there's no honest default for a
      // missing beta, and a position silently dropped from the sum is
      // better than one silently misrepresented.
      if (tickerData == null || underlyingPrice == null || beta == null) continue;

      deltaInputs.push({
        ticker: row.ticker,
        positionType: row.position_type,
        strike: row.strike,
        contracts: row.contracts,
        dte: Math.max(0, daysBetween(new Date().toISOString(), row.expiration_date)),
        underlyingPrice,
        iv: impliedVolFromChain(tickerData, row) ?? DEFAULT_IV_FALLBACK,
        beta,
      });
    }

    if (deltaInputs.length >= MIN_OPEN_POSITIONS_FOR_PORTFOLIO_SUMMARY) {
      portfolioSummary = betaWeightedDelta(deltaInputs, spyPrice);
    }
  }

  return NextResponse.json({ positions, portfolioSummary });
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
