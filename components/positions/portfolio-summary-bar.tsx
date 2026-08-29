"use client";

import { useState } from "react";
import type { PortfolioSummary } from "@/types/api";
import { formatNumber } from "@/lib/format";

export function PortfolioSummaryBar({ summary }: { summary: PortfolioSummary }) {
  const [expanded, setExpanded] = useState(false);

  const total = summary.totalSpyEquivalentShares;
  const direction = total >= 0 ? "long" : "short";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div>
        <span className="text-sm font-semibold text-foreground">
          Portfolio exposure: equivalent to ~{formatNumber(Math.abs(total), 0)} shares of SPY (
          {direction})
        </span>
        <p className="mt-1 text-xs text-muted">
          Your open option positions, beta-weighted against each stock&rsquo;s own market
          sensitivity, add up to roughly this much net directional exposure to the broad market
          &mdash; how much your book currently moves with SPY, not a prediction of what happens
          next.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="min-h-11 w-fit py-1 text-xs text-muted hover:text-foreground lg:min-h-0 lg:py-0"
      >
        {expanded ? "▾ Hide" : "▸ Show"} per-position breakdown
      </button>

      {expanded && (
        <ul className="flex flex-col gap-1 border-t border-border pt-2 text-xs">
          {summary.perPosition.map((p, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="font-mono text-foreground">{p.ticker}</span>
              <span className={`font-mono ${p.contribution >= 0 ? "text-accent" : "text-red-400"}`}>
                {p.contribution >= 0 ? "+" : ""}
                {formatNumber(p.contribution, 1)} shares
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
