"use client";

import { useState } from "react";
import { useJsonFetch } from "@/lib/use-json-fetch";
import type { IvHealthResponse } from "@/types/api";

export function IvHealthBanner() {
  const health = useJsonFetch<IvHealthResponse>("/api/iv-health");
  const [expanded, setExpanded] = useState(false);

  if (health.loading || health.error || !health.data || health.data.healthy) return null;

  const { gaps } = health.data;
  const tickers = gaps.map((g) => g.ticker).join(", ");

  const today = new Date().toISOString().slice(0, 10);
  const severe = gaps.some((g) => g.missingDates.includes(today) || g.missingDates.length >= 3);

  const colorClasses = severe
    ? "border-red-500/50 bg-red-500/10 text-red-200"
    : "border-amber-500/50 bg-amber-500/10 text-amber-200";

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${colorClasses}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>⚠ IV data collection issue detected on {tickers} — click for details</span>
        <span className="shrink-0 text-xs opacity-80">{expanded ? "Hide" : "Details"}</span>
      </button>

      {expanded && (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-current/20 pt-2 text-xs">
          {gaps.map((g) => (
            <li key={g.ticker}>
              <span className="font-mono">{g.ticker}</span>: missing {g.missingDates.length} of{" "}
              {g.expectedCount} expected trading day(s) — {g.missingDates.slice(0, 6).join(", ")}
              {g.missingDates.length > 6 ? `, +${g.missingDates.length - 6} more` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
