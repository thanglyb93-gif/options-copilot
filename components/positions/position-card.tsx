"use client";

import { useState } from "react";
import type { PositionSummary } from "@/types/api";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { PROFIT_TARGET_CC_PCT, PROFIT_TARGET_CSP_PCT } from "@/lib/position-analytics";
import { coveredCallHoldingOutcomes } from "@/lib/options-math";
import { ProfitHistoryChart } from "./profit-history-chart";
import { AssignmentOpportunityCostPanel } from "./assignment-opportunity-cost-panel";

export function PositionCard({
  position,
  onChanged,
}: {
  position: PositionSummary;
  onChanged: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [closingPremiumInput, setClosingPremiumInput] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const a = position.analytics;
  const isCoveredCall = position.position_type === "covered_call";
  const profitTarget = isCoveredCall ? PROFIT_TARGET_CC_PCT : PROFIT_TARGET_CSP_PCT;
  const closeTargetDollars = a?.maxProfit != null ? a.maxProfit * (profitTarget / 100) : null;
  // Same shared 3-part breakdown the pre-trade Strike Selector uses
  // (lib/options-math.ts's coveredCallHoldingOutcomes) -- the math is
  // time-independent (strike, cost basis, shares, premium already
  // collected; no DTE dependence), so it applies unchanged to an
  // already-open position. Cash-secured puts keep the existing blended
  // "Net Covered-Position P/L" card below unchanged -- this reframing
  // is specific to covered calls, where the whole point is that selling
  // against owned shares can never make the position worse, only add
  // premium, which the blended framing obscured.
  const coveredCallOutcomes =
    isCoveredCall && a && position.cost_basis != null && position.shares_owned != null && a.currentUnderlyingPrice != null
      ? coveredCallHoldingOutcomes(
          a.currentUnderlyingPrice,
          position.cost_basis,
          position.strike,
          position.shares_owned,
          position.premium_collected * 100 * position.contracts
        )
      : null;
  // Mathematically bounded at exactly 100% since a real buyback cost can
  // never be negative -- capped defensively in case of a data glitch, per
  // Phase 21's explicit edge-case note. The negative side is uncapped and
  // expected (a position can be meaningfully underwater).
  const profitCapturedBarPct =
    a?.profitCapturedPct != null ? Math.max(0, Math.min(100, a.profitCapturedPct)) : 0;

  async function runAction(action: "close" | "assign") {
    setActionError(null);
    if (action === "close" && !closingPremiumInput) {
      setShowCloseForm(true);
      return;
    }
    setClosing(true);
    try {
      const res = await fetch(`/api/positions/${position.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          closingPremium: action === "close" ? Number(closingPremiumInput) : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(body?.error ?? `Couldn't ${action} this position.`);
        return;
      }
      onChanged();
    } catch {
      setActionError(`Couldn't ${action} this position.`);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-lg font-semibold text-foreground">{position.ticker}</span>
          <span className="text-sm text-muted">
            {isCoveredCall ? "Covered Call" : "Cash-Secured Put"} · {position.strike} strike
          </span>
          {a && <span className="text-sm text-muted">· {a.dte} DTE</span>}
        </div>
        <span className="text-xs text-muted">
          Opened {formatDate(position.opened_at)} · {position.contracts} contract
          {position.contracts !== 1 ? "s" : ""} · premium {formatCurrency(position.premium_collected)}
        </span>
      </div>

      {!a ? (
        <p className="text-sm text-muted">Live analytics unavailable for this ticker right now.</p>
      ) : (
        <>
          {coveredCallOutcomes ? (
            <>
              {/*
                Covered call, 3-part breakdown -- same shared function
                and framing as the pre-trade Strike Selector. NOT the
                blended "Net Covered-Position P/L" figure: selling this
                call against already-owned shares can't make the
                position worse than holding the shares alone. (The
                shares' own unrealized P/L used to be shown as a
                separate context card here -- removed entirely, not just
                relabeled: cost-basis math should never appear alongside
                what's displayed as this call's outcome.)
              */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
                  <span className="text-[11px] uppercase tracking-wide text-muted">
                    If Assigned (price ≥ {formatCurrency(position.strike, 0)} at expiration)
                  </span>
                  <span className="font-mono text-2xl font-bold text-accent">
                    {formatCurrency(coveredCallOutcomes.ifAssigned)}
                  </span>
                  <span className="text-xs text-muted">
                    Shares called away at {formatCurrency(position.strike, 0)}: ({formatCurrency(position.strike, 0)}{" "}
                    − {formatCurrency(position.cost_basis, 0)}) × {position.shares_owned} +{" "}
                    {formatCurrency(position.premium_collected * 100 * position.contracts)} premium collected.
                  </span>
                </div>

                <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
                  <span className="text-[11px] uppercase tracking-wide text-muted">
                    If Not Assigned (price stays below {formatCurrency(position.strike, 0)})
                  </span>
                  <span className="font-mono text-2xl font-bold text-accent">
                    +{formatCurrency(coveredCallOutcomes.ifNotAssigned)}
                  </span>
                  <span className="text-xs text-muted">
                    You keep your {position.shares_owned} shares -- their value stays open/unrealized, unrelated to
                    this decision -- AND permanently keep {formatCurrency(coveredCallOutcomes.ifNotAssigned)} in
                    premium: guaranteed income added to your position regardless of where the stock goes.
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
              <span className="text-[11px] uppercase tracking-wide text-muted">Net Covered-Position P/L</span>
              {a.netCoveredPL != null ? (
                <>
                  <span
                    className={`font-mono text-3xl font-bold ${a.netCoveredPL >= 0 ? "text-accent" : "text-red-400"}`}
                  >
                    {formatCurrency(a.netCoveredPL)}
                  </span>
                  <span className="text-xs text-muted">
                    {isCoveredCall && a.stockPL != null && (
                      <>Stock {formatCurrency(a.stockPL)} + </>
                    )}
                    option leg <span className="font-mono">{formatCurrency(a.optionLegPL)}</span>
                    {a.usingLastPriceFallback && " (last price as of market close, not live)"}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted">
                  {a.contractUnreliable
                    ? "No reliable market for this contract right now."
                    : "Unavailable."}
                </span>
              )}
            </div>
          )}

          {a.profitCapturedPct != null && (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-foreground">
                Profit Captured: {formatPercent(Math.min(100, a.profitCapturedPct), 0)} of 100% max profit
              </span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                <div className="h-full bg-accent/50" style={{ width: `${profitCapturedBarPct}%` }} />
              </div>
            </div>
          )}

          {a.closeSignal.shouldClose && (
            <div className="w-fit rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
              ⚠ Consider closing — {a.closeSignal.reason}
            </div>
          )}

          {a.profitHistory && (
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">
                Profit History
              </span>
              <ProfitHistoryChart
                history={a.profitHistory}
                todayMarker={a.todayMarker}
                maxProfit={a.maxProfit}
                closeTargetDollars={closeTargetDollars}
              />
              {/*
                Option-leg-only trajectory now (see lib/position-
                analytics.ts's profitAtPrice) -- tracks progress toward
                keeping the full premium, the "If Not Assigned" outcome
                above. "If Assigned" is a threshold-crossing outcome tied
                to price vs. strike, not something that decays day by
                day the way option time value does, so it's deliberately
                not plotted here.
              */}
              {coveredCallOutcomes && (
                <p className="mt-1 text-[10px] text-muted">
                  If assigned: see above -- this outcome depends on price crossing{" "}
                  {formatCurrency(position.strike, 0)}, not time decay.
                </p>
              )}
            </div>
          )}

          {a.itmRiskClassification && (
            <div className="flex flex-col gap-2 rounded-md border-2 border-red-500/50 bg-red-500/10 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-red-300">
                  In-the-money — {a.itmRiskClassification.classification === "sell-the-news"
                    ? "Sell-the-News"
                    : a.itmRiskClassification.classification === "real-breakdown"
                      ? "Real Breakdown"
                      : "Unclear"}
                </span>
                <span className="rounded border border-red-500/40 px-2 py-0.5 text-xs uppercase text-red-300">
                  {a.itmRiskClassification.recommendedAction}
                </span>
              </div>
              <ul className="flex flex-col gap-1 text-xs text-red-200">
                {a.itmRiskClassification.reasoning.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          )}

          {a.assignmentOpportunityCost && (
            <AssignmentOpportunityCostPanel result={a.assignmentOpportunityCost} alignment={a.scenarioAlignment} />
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {!showCloseForm ? (
          <>
            <button
              type="button"
              onClick={() => setShowCloseForm(true)}
              disabled={closing}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent/50 disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => runAction("assign")}
              disabled={closing}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent/50 disabled:opacity-50"
            >
              Assign
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted">
              Closing premium (per share)
              <input
                type="number"
                step="0.01"
                value={closingPremiumInput}
                onChange={(e) => setClosingPremiumInput(e.target.value)}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
            <button
              type="button"
              onClick={() => runAction("close")}
              disabled={closing || !closingPremiumInput}
              className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
            >
              Confirm Close
            </button>
            <button
              type="button"
              onClick={() => setShowCloseForm(false)}
              className="text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
        {actionError && <span className="text-xs text-red-400">{actionError}</span>}
      </div>
    </div>
  );
}
