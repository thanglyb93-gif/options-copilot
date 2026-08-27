"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useJsonFetch } from "@/lib/use-json-fetch";
import type { WatchlistRow, WatchlistSummaryResponse } from "@/types/api";
import { formatCurrency, formatPercent } from "@/lib/format";

export function WatchlistCard({
  row,
  onRemove,
}: {
  row: WatchlistRow;
  onRemove: (id: string) => void;
}) {
  const router = useRouter();
  const summary = useJsonFetch<WatchlistSummaryResponse>(`/api/watchlist-summary/${row.ticker}`);
  const [removing, setRemoving] = useState(false);

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setRemoving(true);
    try {
      const res = await fetch(`/api/watchlist?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onRemove(row.id);
      } else {
        setRemoving(false);
      }
    } catch {
      setRemoving(false);
    }
  }

  return (
    <div
      onClick={() => router.push(`/ticker/${row.ticker}`)}
      className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 overflow-hidden">
          <span className="font-mono text-sm font-semibold text-foreground">{row.ticker}</span>
          {summary.data && (
            <span className="truncate text-xs text-muted">{summary.data.name}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          aria-label={`Remove ${row.ticker} from watchlist`}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-white/10 hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {summary.loading && (
        <div className="flex flex-col gap-2">
          <div className="h-5 w-20 animate-pulse rounded bg-white/5" />
          <div className="h-4 w-32 animate-pulse rounded bg-white/5" />
        </div>
      )}

      {summary.error && <p className="text-xs text-red-400">{summary.error}</p>}

      {summary.data && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg text-foreground">
              {formatCurrency(summary.data.price)}
            </span>
            <span
              className={`font-mono text-xs ${
                (summary.data.dayChangePercent ?? 0) >= 0 ? "text-accent" : "text-red-400"
              }`}
            >
              {formatPercent(summary.data.dayChangePercent)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>
              % from 52w high:{" "}
              <span className="font-mono text-foreground">
                {formatPercent(summary.data.percentFrom52wHigh)}
              </span>
            </span>
            <span>
              {summary.data.ivHvRatio != null ? (
                <>
                  IV/HV:{" "}
                  <span className="font-mono text-foreground">
                    {summary.data.ivHvRatio.toFixed(2)}
                  </span>
                </>
              ) : summary.data.hv30 != null ? (
                <>
                  30d HV:{" "}
                  <span className="font-mono text-foreground">
                    {formatPercent(summary.data.hv30 * 100, 0)}
                  </span>{" "}
                  <span title="Front-month IV is currently unreliable or unavailable (no live market)">
                    (IV unavailable)
                  </span>
                </>
              ) : (
                <>IV/HV: —</>
              )}
            </span>
          </div>

          {!summary.data.ivHistory.hasEnoughHistory && (
            <span className="text-xs text-muted">
              IV rank: building history ({summary.data.ivHistory.count}/{summary.data.ivHistory.needed})
            </span>
          )}

          {summary.data.earningsCooldownFlagged && (
            <span className="w-fit rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
              Earnings cooldown
            </span>
          )}
        </>
      )}
    </div>
  );
}
