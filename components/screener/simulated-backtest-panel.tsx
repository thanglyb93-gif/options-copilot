"use client";

import { useState } from "react";
import { useJsonFetch } from "@/lib/use-json-fetch";
import type { SimulatedBacktestResponse, SimulatedEntry } from "@/types/api";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";

/**
 * Every heading/caption in this component must make the simulation
 * framing visible where it's actually read, not just once at the
 * bottom -- see Phase 29's brief. This banner is reused at the top of
 * the section AND the per-entry table gets its own header repeating it,
 * so a reader scrolling straight to the entry list still sees it.
 */
function SimulationBanner() {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Simulated backtest -- real historical prices, modeled option premiums
    </div>
  );
}

function StatBox({ label, value, valueClassName = "text-foreground" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-lg font-semibold ${valueClassName}`}>{value}</span>
    </div>
  );
}

function EntryRow({ entry }: { entry: SimulatedEntry }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border py-2 text-sm first:border-t-0 sm:grid-cols-6">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted">Entry</span>
        <span className="font-mono text-foreground">{formatDate(entry.entryDate)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted">Modeled strike</span>
        <span className="font-mono text-foreground">
          {entry.strike} <span className="text-xs text-muted">(spot {formatCurrency(entry.entryPrice, 0)})</span>
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted">Modeled premium</span>
        <span className="font-mono text-foreground">{formatCurrency(entry.premiumPerShare)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted">Modeled expiry</span>
        <span className="font-mono text-foreground">
          {formatDate(entry.expirationDate)} <span className="text-xs text-muted">({entry.dte}d)</span>
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted">Real close at expiry</span>
        <span className="font-mono text-foreground">{formatCurrency(entry.finalPrice, 0)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted">Simulated outcome</span>
        <span className={`font-mono ${entry.assigned ? "text-red-400" : "text-accent"}`}>
          {entry.assigned ? "Assigned" : "Not assigned"} ({formatPercent(entry.returnPct)})
        </span>
      </div>
    </div>
  );
}

export function SimulatedBacktestPanel({ ticker }: { ticker: string }) {
  const [direction, setDirection] = useState<"put" | "call">("put");
  const { data, loading, error } = useJsonFetch<SimulatedBacktestResponse>(
    `/api/backtest/${ticker}?direction=${direction}`
  );

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">Simulated Track Record (6mo)</span>
        <div className="flex w-fit gap-1 rounded-md border border-border p-0.5">
          {(["put", "call"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`min-h-11 rounded px-2.5 py-1 text-xs lg:min-h-0 ${
                direction === d ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {d === "put" ? "Sell Put" : "Sell Call"}
            </button>
          ))}
        </div>
      </div>

      <SimulationBanner />
      <p className="text-xs leading-relaxed text-muted">
        This is a model applied retroactively to {ticker}&rsquo;s real historical closing prices -- not a record of
        actual past trades, and not backed by real historical options-market data (no free source provides that).
        Entry strikes are modeled using this app&rsquo;s own EM-cushion targeting ({data?.targetCushion ?? "1.5"}x
        expected move, ~{data?.targetDte ?? 37} DTE) and this app&rsquo;s own trailing-volatility IV estimate, then
        priced with Black-Scholes and walked forward against real subsequent closes.
      </p>

      {loading && <p className="text-sm text-muted">Running simulation…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {data && data.entries.length === 0 && (
        <p className="text-sm text-muted">
          Not enough historical price data for {ticker} to simulate any entries over the last {data.lookbackMonths}{" "}
          months.
        </p>
      )}

      {data && data.entries.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox
              label="Simulated win rate"
              value={data.winRate != null ? `${data.winRate.toFixed(0)}%` : "—"}
              valueClassName={data.winRate != null && data.winRate >= 50 ? "text-accent" : "text-red-400"}
            />
            <StatBox
              label="Avg simulated return"
              value={data.avgReturnPct != null ? formatPercent(data.avgReturnPct) : "—"}
              valueClassName={
                data.avgReturnPct != null && data.avgReturnPct >= 0 ? "text-accent" : "text-red-400"
              }
            />
            <StatBox
              label="Best simulated entry"
              value={data.bestEntry ? formatPercent(data.bestEntry.returnPct) : "—"}
              valueClassName="text-accent"
            />
            <StatBox
              label="Worst simulated entry"
              value={data.worstEntry ? formatPercent(data.worstEntry.returnPct) : "—"}
              valueClassName="text-red-400"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted">
              Simulated entries ({data.entries.length}) -- modeled, not real trades
            </span>
            <div className="flex flex-col rounded-md border border-border bg-background px-3">
              {data.entries.map((entry) => (
                <EntryRow key={entry.entryDate} entry={entry} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
