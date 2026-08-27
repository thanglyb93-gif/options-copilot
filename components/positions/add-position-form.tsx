"use client";

import { useEffect, useState } from "react";
import { TickerSearchInput } from "@/components/ticker-search-input";
import type { PositionsListResponse, SearchMatch } from "@/types/api";
import { formatCurrency } from "@/lib/format";

type PositionType = "covered_call" | "cash_secured_put";

function nowForDatetimeLocal(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function computeDte(expirationDate: string): number | null {
  if (!expirationDate) return null;
  const exp = new Date(`${expirationDate}T00:00:00Z`).getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((exp - todayUtc) / (24 * 60 * 60 * 1000));
}

export function AddPositionForm({ onAdded }: { onAdded: () => void }) {
  const [positionType, setPositionType] = useState<PositionType>("cash_secured_put");
  const [ticker, setTicker] = useState("");
  const [strike, setStrike] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [premiumPerShare, setPremiumPerShare] = useState("");
  const [contracts, setContracts] = useState("1");
  const [sharesOwned, setSharesOwned] = useState("100");
  const [sharesTouched, setSharesTouched] = useState(false);
  const [costBasis, setCostBasis] = useState("");
  const [costBasisFromPosition, setCostBasisFromPosition] = useState(false);
  const [executedAt, setExecutedAt] = useState(nowForDatetimeLocal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Default shares owned to contracts * 100, unless the user has
  // manually edited it -- same "prefill but stay editable" pattern as
  // cost basis below.
  useEffect(() => {
    if (sharesTouched) return;
    const c = Number(contracts);
    if (Number.isFinite(c) && c > 0) setSharesOwned(String(c * 100));
  }, [contracts, sharesTouched]);

  // Prefill cost basis from an existing open position on this ticker,
  // same pattern as the Strike Selector's prefill.
  useEffect(() => {
    if (positionType !== "covered_call" || !ticker) {
      setCostBasisFromPosition(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/positions?status=open`)
      .then((res) => res.json())
      .then((body: PositionsListResponse) => {
        if (cancelled) return;
        const match = body.positions?.find(
          (p) => p.ticker === ticker.toUpperCase() && (p.shares_owned ?? 0) > 0 && p.cost_basis != null
        );
        if (match && match.cost_basis != null) {
          setCostBasis(String(match.cost_basis));
          setCostBasisFromPosition(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticker, positionType]);

  const dte = computeDte(expirationDate);
  const totalPremium =
    premiumPerShare && contracts
      ? Number(premiumPerShare) * 100 * Number(contracts)
      : null;

  function handleTickerSelect(match: SearchMatch) {
    setTicker(match.symbol.toUpperCase());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!ticker || !strike || !expirationDate || !premiumPerShare || !contracts) {
      setError("All fields are required.");
      return;
    }
    if (positionType === "covered_call" && (!sharesOwned || !costBasis)) {
      setError("Shares owned and cost basis are required for a covered call.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          position_type: positionType,
          strike: Number(strike),
          premium_collected: Number(premiumPerShare),
          expiration_date: expirationDate,
          contracts: Number(contracts),
          shares_owned: positionType === "covered_call" ? Number(sharesOwned) : null,
          cost_basis: positionType === "covered_call" ? Number(costBasis) : null,
          opened_at: new Date(executedAt).toISOString(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't log this position.");
        return;
      }

      // Reset for the next entry.
      setTicker("");
      setStrike("");
      setExpirationDate("");
      setPremiumPerShare("");
      setContracts("1");
      setSharesOwned("100");
      setSharesTouched(false);
      setCostBasis("");
      setCostBasisFromPosition(false);
      setExecutedAt(nowForDatetimeLocal());
      setExpanded(false);
      onAdded();
    } catch {
      setError("Couldn't log this position.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-fit rounded-md border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/20"
      >
        + Add Position
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Add Position</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted">
        Position Type
        <div className="flex w-fit gap-1 rounded-md border border-border p-0.5">
          {(
            [
              { value: "cash_secured_put", label: "Sell Put (Cash-Secured Put)" },
              { value: "covered_call", label: "Sell Call (Covered Call)" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPositionType(opt.value)}
              className={`rounded px-3 py-1.5 text-sm ${
                positionType === opt.value
                  ? "bg-accent/15 text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Ticker
        <TickerSearchInput onSelect={handleTickerSelect} clearOnSelect={false} placeholder="e.g. AAPL, apple" />
        {ticker && <span className="text-[11px] text-foreground">Selected: {ticker}</span>}
      </label>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Strike Price
          <input
            type="number"
            step="0.5"
            value={strike}
            onChange={(e) => setStrike(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Expiration Date
          <input
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
          {dte != null && <span className="text-[11px] text-foreground">{dte} DTE</span>}
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Premium Collected (per share)
          <input
            type="number"
            step="0.01"
            value={premiumPerShare}
            onChange={(e) => setPremiumPerShare(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
          {totalPremium != null && (
            <span className="text-[11px] text-foreground">Total: {formatCurrency(totalPremium)}</span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Contracts
          <input
            type="number"
            step="1"
            min="1"
            value={contracts}
            onChange={(e) => setContracts(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>

      {positionType === "covered_call" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Shares Owned
            <input
              type="number"
              step="1"
              value={sharesOwned}
              onChange={(e) => {
                setSharesOwned(e.target.value);
                setSharesTouched(true);
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Cost Basis (per share)
            <input
              type="number"
              step="0.01"
              value={costBasis}
              onChange={(e) => {
                setCostBasis(e.target.value);
                setCostBasisFromPosition(false);
              }}
              placeholder="e.g. 231.00"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
            {costBasisFromPosition && (
              <span className="text-[10px] text-muted">from your tracked position</span>
            )}
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted">
        Execution Date &amp; Time
        <input
          type="datetime-local"
          value={executedAt}
          onChange={(e) => setExecutedAt(e.target.value)}
          className="w-fit rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/20 disabled:opacity-50"
      >
        {submitting ? "Logging…" : "Log Position"}
      </button>
    </form>
  );
}
