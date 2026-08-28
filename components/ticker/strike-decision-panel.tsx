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
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import type { FetchState } from "@/lib/use-json-fetch";
import type { EntryScoreResponse } from "@/types/api";
import { SubsectionHeader } from "./section";
import { EntryScorePanel } from "./entry-score-panel";
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
  putScore: FetchState<EntryScoreResponse>;
  callScore: FetchState<EntryScoreResponse>;
}) {
  const assignmentProbabilityIndicator = guidanceIndicatorById("assignment-probability");
  const emCushionIndicator = guidanceIndicatorById("technical-em-cushion");
  const spreadIndicator = guidanceIndicatorById("liquidity-spread-score");
  const openInterestIndicator = guidanceIndicatorById("open-interest");

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
    // Strike-specific content (Summary, Assignment Probability/EM
    // Cushion/Spread/OI, the chart) genuinely needs a valid selected
    // contract. The Entry Score preview doesn't -- it already renders a
    // partial (ticker-level) total with a null selection -- so it still
    // shows here rather than disappearing entirely while no contract is
    // selected (e.g. the auto-picked default strike having no live
    // market to price a premium from).
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          Select a DTE, strike, and direction above to see the full decision breakdown.
        </p>
        <div className="flex flex-col gap-3">
          <SubsectionHeader title="Making Decisions" />
          <EntryScorePanel putScore={putScore} callScore={callScore} selection={null} />
        </div>
      </div>
    );
  }

  const tickerScore = selection.direction === "put" ? putScore.data : callScore.data;
  const opposesTradeDirection = tickerScore?.eventComponent.opposesTradeDirection ?? false;

  const missingCostBasis = positionType === "covered_call" && costBasis == null;

  // Deliberately NOT a single blended "position P/L" number. Selling a
  // covered call against shares already owned can never make the
  // position worse than just holding the shares -- it only ever adds
  // premium, with capped upside as the sole tradeoff. Blending the
  // stock's pre-existing unrealized P/L (which exists whether or not
  // this call gets sold) together with the premium into one figure
  // made selling the call look like it caused a loss, which is wrong.
  // These stay as three separate numbers: the shares' own P/L (context,
  // not attributable to this decision), and the two actual outcomes of
  // selling the call, in both of which the premium is pure additive
  // upside.
  const stockPL =
    positionType === "covered_call" && costBasis != null && currentPrice != null
      ? (currentPrice - costBasis) * shares
      : null;

  return (
    <div className="flex flex-col gap-5">
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
        {selection.contract.usingLastPriceFallback && (
          <span
            className="text-xs text-muted"
            title="Market is closed -- no live bid/ask. Using the last traded price and greeks estimated from it."
          >
            (last price as of market close, not live)
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SubsectionHeader title="Summary" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Premium" value={formatCurrency(selection.premium)} />
          <StatCard label="Current Price" value={formatCurrency(currentPrice)} />
          {/* Max Profit/Breakeven/Return-if-OTM/Annualized all depend on
              cost basis for a covered call (capitalAtRisk = costBasis *
              shares) -- with no cost basis entered they'd be computed
              against a fake $0 basis, so they stay hidden behind the
              same missingCostBasis gate the chart already uses, rather
              than showing a nonsensical number alongside the message
              below explaining why it's missing. */}
          {!missingCostBasis && (
            <>
              <StatCard label="Max Profit" value={formatCurrency(maxProfit)} />
              <StatCard label="Breakeven" value={formatCurrency(breakeven)} />
              <StatCard label="Return if OTM" value={formatPercent(returnIfOtm)} />
              <StatCard label="Annualized Return" value={formatPercent(annualized)} />
            </>
          )}
        </div>

        {missingCostBasis && (
          <p className="text-sm text-muted">
            Enter a cost basis above to see profit/loss for this covered call.
          </p>
        )}

        {!missingCostBasis && stockPL != null && costBasis != null && (
          <div className="flex flex-col gap-3">
            {/*
              1. The shares' own unrealized P/L -- pre-existing, exists
              whether or not this call gets sold. Shown as context, not
              as part of the call decision's own outcome.
            */}
            <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-4 py-3">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                Your Shares Today (independent of this call decision)
              </span>
              <span
                className={`font-mono text-2xl font-bold ${stockPL >= 0 ? "text-accent" : "text-red-400"}`}
              >
                {formatCurrency(stockPL)}
              </span>
              <span className="text-xs text-muted">
                Your {shares} shares (cost basis {formatCurrency(costBasis)}): {formatCurrency(stockPL)} unrealized
                -- this exists regardless of whether you sell this call.
              </span>
            </div>

            {/*
              2 & 3. The two actual outcomes of selling THIS call. In
              both, the premium is pure additive upside -- assignment
              only caps how much further the shares can help, it never
              turns the premium into a cost.
            */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  If Assigned (price ≥ {formatCurrency(strike, 0)} at expiration)
                </span>
                <span className="font-mono text-2xl font-bold text-accent">{formatCurrency(maxProfit)}</span>
                <span className="text-xs text-muted">
                  Shares called away at {formatCurrency(strike, 0)}: ({formatCurrency(strike, 0)} −{" "}
                  {formatCurrency(costBasis, 0)}) × {shares} + {formatCurrency(totalPremium)} premium collected.
                </span>
              </div>

              <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  If Not Assigned (price stays below {formatCurrency(strike, 0)})
                </span>
                <span className="font-mono text-2xl font-bold text-accent">+{formatCurrency(totalPremium)}</span>
                <span className="text-xs text-muted">
                  You keep your {shares} shares -- their value stays open/unrealized, unrelated to this decision --
                  AND permanently keep {formatCurrency(totalPremium)} in premium: guaranteed income added to your
                  position regardless of where the stock goes.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SubsectionHeader title="Making Decisions" />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              Assignment Probability
              {assignmentProbabilityIndicator && (
                <ImportanceBadge tier={assignmentProbabilityIndicator.importanceTier} />
              )}
            </span>
            <span className="font-mono text-2xl font-semibold text-foreground">
              {selection.contract.assignmentProbability ?? "—"}
            </span>
            {selection.contract.probabilityOfTouch != null && (
              <span className="text-xs text-muted">Touch: {selection.contract.probabilityOfTouch}</span>
            )}
          </div>

          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              EM Cushion
              {emCushionIndicator && <ImportanceBadge tier={emCushionIndicator.importanceTier} />}
            </span>
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

          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              Spread / Liquidity
              {spreadIndicator && <ImportanceBadge tier={spreadIndicator.importanceTier} />}
            </span>
            <span className="font-mono text-2xl font-semibold text-foreground">
              {selection.contract.spreadPct != null ? `${selection.contract.spreadPct.toFixed(1)}%` : "—"}
            </span>
            <span className="text-xs text-muted">
              {selection.contract.spreadLabel ?? "no live market"}
              {selection.contract.spreadLabel === "wide" && (
                <span className="ml-1 text-red-400">⚠ wide</span>
              )}
            </span>
          </div>

          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              Open Interest
              {openInterestIndicator && <ImportanceBadge tier={openInterestIndicator.importanceTier} />}
            </span>
            <span className="font-mono text-2xl font-semibold text-foreground">
              {selection.contract.openInterest != null ? selection.contract.openInterest.toLocaleString() : "—"}
            </span>
            <span className="text-xs text-muted">contracts</span>
          </div>
        </div>

        <EntryScorePanel putScore={putScore} callScore={callScore} selection={selection} />

        {!missingCostBasis && (
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
        )}
      </div>
    </div>
  );
}
