"use client";

import { useState } from "react";
import type { RelativeStrengthWindow, ScreenerResponse } from "@/types/api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { SuitabilityBadge } from "./suitability-badge";

function StructuralTrendLabel({ trend }: { trend: ScreenerResponse["evaluation"]["structuralTrend"] }) {
  if (trend === "higher-highs-higher-lows") return <>Higher highs, higher lows</>;
  if (trend === "lower-highs-lower-lows") return <>Lower highs, lower lows</>;
  if (trend === "mixed") return <>Mixed</>;
  return <>Not enough history</>;
}

function ComparisonStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span
        className={`font-mono text-2xl font-semibold ${
          value == null ? "text-muted" : value >= 0 ? "text-accent" : "text-red-400"
        }`}
      >
        {value != null ? formatPercent(value, 1) : "—"}
      </span>
    </div>
  );
}

export function ScreenerResultCard({
  data,
  onAddToWatchlist,
  adding,
  added,
  addError,
}: {
  data: ScreenerResponse;
  onAddToWatchlist: () => void;
  adding: boolean;
  added: boolean;
  addError: string | null;
}) {
  const [window, setWindow] = useState<"180" | "90">("180");
  const activeWindow: RelativeStrengthWindow = window === "180" ? data.evaluation.window180 : data.evaluation.window90;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-semibold text-foreground">{data.ticker}</span>
            <span className="text-sm text-muted">{data.name}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xl text-foreground">{formatCurrency(data.price)}</span>
            <span
              className={`font-mono text-sm ${(data.dayChangePercent ?? 0) >= 0 ? "text-accent" : "text-red-400"}`}
            >
              {formatPercent(data.dayChangePercent)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onAddToWatchlist}
          disabled={adding || added}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent/50 disabled:opacity-50"
        >
          {added ? "✓ Added to Watchlist" : adding ? "Adding…" : "+ Add to Watchlist"}
        </button>
      </div>
      {addError && <p className="text-xs text-red-400">{addError}</p>}

      <div className="flex items-center justify-between gap-3">
        <SuitabilityBadge suitability={data.evaluation.suitability} />

        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(["180", "90"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={`rounded px-2.5 py-1 text-xs ${
                window === w ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <ComparisonStat label="vs SPY" value={activeWindow.vsMarketPct} />
        <ComparisonStat
          label={data.sectorGroup ? `vs ${data.sectorGroup.name} peers` : "vs Sector"}
          value={activeWindow.vsSectorPct}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-muted">Structural trend (~9mo)</span>
          <span className="text-sm font-medium text-foreground">
            <StructuralTrendLabel trend={data.evaluation.structuralTrend} />
          </span>
        </div>
      </div>

      {!data.sectorGroup && (
        <p className="text-xs text-muted">
          No sector peer group defined for {data.ticker} yet -- comparison falls back to SPY only.
        </p>
      )}

      <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>

      <p className="text-[11px] leading-relaxed text-muted">
        Reflects historical relative performance only -- not a guarantee of future results, and not a substitute
        for your own judgment.
      </p>
    </div>
  );
}
