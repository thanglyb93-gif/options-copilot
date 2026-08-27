"use client";

import { useState } from "react";
import type { PositionSummary } from "@/types/api";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { PROFIT_TARGET_CC_PCT, PROFIT_TARGET_CSP_PCT } from "@/lib/position-analytics";
import { DecayCurveChart } from "./decay-curve-chart";

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
  const progressPct = a?.profitCapturedPct != null ? Math.max(0, Math.min(100, (a.profitCapturedPct / profitTarget) * 100)) : 0;

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

          {a.profitCapturedPct != null && (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-xs text-muted">
                <span>Profit Captured</span>
                <span className="font-mono text-foreground">
                  {formatPercent(a.profitCapturedPct, 0)} of {profitTarget}% target
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                <div
                  className={`h-full ${a.profitCapturedPct >= profitTarget ? "bg-accent" : "bg-accent/50"}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {a.closeSignal.shouldClose && (
            <div className="w-fit rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
              ⚠ Consider closing — {a.closeSignal.reason}
            </div>
          )}

          <div>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">
              Theta Decay Curve (today marked)
            </span>
            <DecayCurveChart curve={a.decayCurve} currentDte={a.dte} />
          </div>

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
