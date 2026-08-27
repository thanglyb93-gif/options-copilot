"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  annualizedReturn,
  cashSecuredPutBreakeven,
  cashSecuredPutPL,
  coveredCallBreakeven,
  coveredCallPL,
} from "@/lib/options-math";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { EntryScoreResponse } from "@/types/api";
import type { StrikeSelection } from "./strike-selector";

/** Standard equity option contract size. No UI control for this -- there's
 * nothing to configure, every contract here covers 100 shares. */
const SHARES_PER_CONTRACT = 100;

function StatCard({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-foreground ${big ? "text-2xl font-semibold" : "text-base"}`}>
        {value}
      </span>
    </div>
  );
}

export function StrikeDecisionPanel({
  selection,
  currentPrice,
  putScore,
  callScore,
}: {
  selection: StrikeSelection | null;
  currentPrice: number | null;
  putScore: EntryScoreResponse | null;
  callScore: EntryScoreResponse | null;
}) {
  // Everything below is derived directly from the top-level Strike
  // Selector's state (selection) and the live quote (currentPrice) --
  // there is no independent local copy of position type, strike,
  // premium, DTE, or shares. A prior version kept its own editable
  // "what-if" mini-form (with its own Covered Call/Cash-Secured Put
  // toggle) seeded from `selection`; that was leftover Phase 3 simulator
  // UI that could silently drift from the top-level controls and has
  // been removed entirely, not just hidden.
  const positionType = selection?.positionType ?? "covered_call";
  const strike = selection?.strike ?? 0;
  const premiumPerShare = selection?.premium ?? 0;
  const dte = selection?.dte ?? 0;
  const shares = SHARES_PER_CONTRACT;
  const costBasis = selection?.costBasis ?? null;

  const totalPremium = premiumPerShare * shares;
  const capitalAtRisk =
    positionType === "covered_call" ? (costBasis ?? 0) * shares : strike * shares;

  const maxProfit =
    positionType === "covered_call"
      ? coveredCallPL(strike, strike, costBasis ?? 0, shares, totalPremium)
      : cashSecuredPutPL(strike, strike, totalPremium, shares);

  const breakeven =
    positionType === "covered_call"
      ? coveredCallBreakeven(costBasis ?? 0, premiumPerShare)
      : cashSecuredPutBreakeven(strike, premiumPerShare);

  const returnIfOtm = capitalAtRisk > 0 ? (totalPremium / capitalAtRisk) * 100 : null;
  const annualized =
    capitalAtRisk > 0 && dte > 0
      ? annualizedReturn(totalPremium, capitalAtRisk, dte) * 100
      : null;

  const chartData = useMemo(() => {
    const center = currentPrice != null && currentPrice > 0 ? currentPrice : strike || 100;
    const points = 41;
    return Array.from({ length: points }, (_, i) => {
      const s = center * (0.75 + (i / (points - 1)) * 0.5);
      const pl =
        positionType === "covered_call"
          ? coveredCallPL(s, strike, costBasis ?? 0, shares, totalPremium)
          : cashSecuredPutPL(s, strike, totalPremium, shares);
      return {
        price: Math.round(s * 100) / 100,
        pl: Math.round(pl * 100) / 100,
        plPositive: Math.max(pl, 0),
        plNegative: Math.min(pl, 0),
      };
    });
  }, [currentPrice, strike, costBasis, shares, totalPremium, positionType]);

  if (!selection) {
    return (
      <p className="text-sm text-muted">
        Select a DTE, strike, and direction above to see the full decision breakdown.
      </p>
    );
  }

  const tickerScore = selection.direction === "put" ? putScore : callScore;
  const opposesTradeDirection = tickerScore?.eventComponent.opposesTradeDirection ?? false;

  const missingCostBasis = positionType === "covered_call" && costBasis == null;

  const netPosition =
    positionType === "covered_call" && costBasis != null && currentPrice != null
      ? {
          stockPL: (currentPrice - costBasis) * shares,
          optionPL: totalPremium,
          net: (currentPrice - costBasis) * shares + totalPremium,
        }
      : null;

  const underwaterBy =
    positionType === "covered_call" && costBasis != null && currentPrice != null && costBasis > currentPrice
      ? costBasis - currentPrice
      : null;

  return (
    <div className="flex flex-col gap-4">
      {opposesTradeDirection && tickerScore && (
        <div className="rounded-md border border-red-500/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300">
          ⚠ Directional signal opposes this trade: {tickerScore.eventComponent.rationale}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-mono text-foreground">
          {selection.strike} {selection.direction === "put" ? "P" : "C"}
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          exp <span className="font-mono text-foreground">{selection.expirationDate}</span>
        </span>
        <span className="text-muted">
          (<span className="font-mono text-foreground">{selection.dte}</span> DTE)
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          premium <span className="font-mono text-foreground">{formatCurrency(selection.premium)}</span>
        </span>
        {selection.contract.usingLastPriceFallback && (
          <span
            className="text-xs text-muted"
            title="Market is closed -- no live bid/ask. Using the last traded price and greeks estimated from it."
          >
            (last price as of market close, not live)
          </span>
        )}
      </div>

      {/*
        Total entry score intentionally NOT shown here -- the Entry Score
        cards above are the single source of truth for that number (see
        entry-score-panel.tsx's combineWithStrikeCushion), so it can't
        disagree with what's shown there. This panel only surfaces detail
        specific to the selected contract.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Assignment Probability"
          value={selection.contract.assignmentProbability ?? "—"}
          big
        />
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">EM Cushion</span>
          <span className="font-mono text-2xl font-semibold text-foreground">
            {selection.contract.emCushion != null ? `${selection.contract.emCushion.toFixed(2)}x` : "—"}
          </span>
          <span className="text-xs text-muted">
            score {selection.contract.cushionScore != null ? formatNumber(selection.contract.cushionScore, 1) : "—"}
            {selection.contract.structuralConfirmation?.confirmed && (
              <span className="ml-1 text-accent">
                ✓ below/above {selection.contract.structuralConfirmation.referenceLabel}
              </span>
            )}
          </span>
        </div>
      </div>

      {missingCostBasis ? (
        <p className="text-sm text-muted">
          Enter a cost basis above to see profit/loss for this covered call.
        </p>
      ) : (
        <>
          {netPosition && (
            <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                Net Covered-Position P/L
              </span>
              <span
                className={`font-mono text-3xl font-bold ${
                  netPosition.net >= 0 ? "text-accent" : "text-red-400"
                }`}
              >
                {formatCurrency(netPosition.net)}
              </span>
              <span className="text-xs text-muted">
                Stock {formatCurrency(netPosition.stockPL)} + option leg (premium){" "}
                <span className="font-mono">{formatCurrency(netPosition.optionPL)}</span>
              </span>
            </div>
          )}

          {underwaterBy != null && (
            <p className="text-xs text-muted">
              ℹ Shares currently below cost basis by {formatCurrency(underwaterBy)}.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Max Profit" value={formatCurrency(maxProfit)} />
            <StatCard label="Breakeven" value={formatCurrency(breakeven)} />
            <StatCard label="Return if OTM" value={formatPercent(returnIfOtm)} />
            <StatCard label="Annualized Return" value={formatPercent(annualized)} />
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="price"
                  stroke="var(--muted)"
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  tickFormatter={(v) => formatCurrency(v, 0)}
                />
                <YAxis
                  stroke="var(--muted)"
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  tickFormatter={(v) => formatCurrency(v, 0)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                  formatter={(value) => formatCurrency(Number(value))}
                  labelFormatter={(label) => `Price: ${formatCurrency(Number(label))}`}
                />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <ReferenceLine
                  x={breakeven}
                  stroke="var(--foreground)"
                  strokeDasharray="4 4"
                  label={{ value: "BE", fill: "var(--muted)", fontSize: 11 }}
                />
                <Area
                  type="monotone"
                  dataKey="plPositive"
                  stroke="none"
                  fill="var(--accent)"
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="plNegative"
                  stroke="none"
                  fill="#f87171"
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="pl"
                  stroke="var(--foreground)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
