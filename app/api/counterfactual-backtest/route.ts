import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { fetchHistoricalCloses } from "@/lib/yahoo";
import { peerTickersFor, sectorGroupForTicker } from "@/lib/sector-groups";
import type { PeerHistoricals } from "@/lib/relative-strength";
import { computeCounterfactual, type CounterfactualInputPosition } from "@/lib/counterfactual-backtest";
import type { PositionRow } from "@/types/database";

/**
 * Phase 38 -- scans every imported losing covered-call trade and
 * computes what Phase 34's momentum-adjusted cushion buffer would have
 * suggested at that historical entry. One ticker's history can need a
 * multi-year Yahoo fetch (SPY + peers included), so this can chain
 * several real round-trips -- same reasoning as this app's other
 * multi-fetch routes' maxDuration.
 */
export const maxDuration = 60;

/** Calendar days of margin fetched before the oldest losing entry for a ticker -- covers historicalVolatility's 30-day window plus relative-strength's own ~400-day lookback need. */
const HISTORY_MARGIN_DAYS = 500;

function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export async function GET() {
  const supabase = getSupabaseRouteClient();

  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .eq("position_type", "covered_call")
    .eq("status", "closed")
    .lt("realized_pl", 0);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const losingPositions = (data ?? []) as PositionRow[];
  const asOf = new Date().toISOString();

  if (losingPositions.length === 0) {
    return NextResponse.json({ comparisons: [], skipped: [], asOf });
  }

  const today = asOf.slice(0, 10);
  const byTicker = new Map<string, PositionRow[]>();
  for (const p of losingPositions) {
    const list = byTicker.get(p.ticker) ?? [];
    list.push(p);
    byTicker.set(p.ticker, list);
  }

  const comparisons: NonNullable<ReturnType<typeof computeCounterfactual>>[] = [];
  const skipped: { positionId: string; ticker: string; reason: string }[] = [];

  for (const [ticker, positions] of Array.from(byTicker.entries())) {
    const oldestOpenedAt = positions.reduce(
      (oldest, p) => (p.opened_at.slice(0, 10) < oldest ? p.opened_at.slice(0, 10) : oldest),
      positions[0].opened_at.slice(0, 10)
    );
    const daysNeeded = daysBetween(oldestOpenedAt, today) + HISTORY_MARGIN_DAYS;

    const group = sectorGroupForTicker(ticker);
    const peerTickers = peerTickersFor(ticker);

    try {
      const [closes, spyCloses, peerResults] = await Promise.all([
        fetchHistoricalCloses(ticker, daysNeeded),
        fetchHistoricalCloses("SPY", daysNeeded),
        Promise.all(
          peerTickers.map(async (peer): Promise<PeerHistoricals | null> => {
            try {
              const peerCloses = await fetchHistoricalCloses(peer, daysNeeded);
              return { ticker: peer, closes: peerCloses };
            } catch {
              return null;
            }
          })
        ),
      ]);
      const peerHistoricals = peerResults.filter((p): p is PeerHistoricals => p != null);

      for (const p of positions) {
        const input: CounterfactualInputPosition = {
          positionId: p.id,
          ticker: p.ticker,
          strike: p.strike,
          premiumCollected: p.premium_collected,
          contracts: p.contracts,
          openedAt: p.opened_at.slice(0, 10),
          expirationDate: p.expiration_date,
          realizedPl: p.realized_pl ?? 0,
        };
        const result = computeCounterfactual(
          input,
          closes,
          spyCloses,
          group ? peerHistoricals : null,
          group?.name ?? null
        );
        if (result) {
          comparisons.push(result);
        } else {
          skipped.push({
            positionId: p.id,
            ticker: p.ticker,
            reason: "Not enough historical price data to reconstruct the entry context or walk to the real expiration close.",
          });
        }
      }
    } catch (err) {
      for (const p of positions) {
        skipped.push({
          positionId: p.id,
          ticker: p.ticker,
          reason: err instanceof Error ? err.message : "Failed to fetch historical data for this ticker.",
        });
      }
    }
  }

  return NextResponse.json({ comparisons, skipped, asOf });
}
