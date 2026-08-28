"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useJsonFetch } from "@/lib/use-json-fetch";
import type { IvRankSummary, WatchlistRow, WatchlistSummaryResponse } from "@/types/api";
import { formatCurrency, formatPercent } from "@/lib/format";

/**
 * This card has exactly one volatility-percentile slot -- for the weeks
 * before IV Percentile matures (needs IV_HISTORY_MIN_ROWS real daily
 * snapshots), showing "Nd/needed" wasted that slot on a placeholder
 * instead of a real number. HV Percentile is available immediately (no
 * accumulation period, same calculation the ticker Overview's HV
 * Percentile stat uses) so it fills the slot until IV Percentile takes
 * over -- clearly labeled either way so it's never ambiguous which
 * metric is showing.
 */
function volatilityField(ivRank: IvRankSummary): { label: string; value: string } {
  const ivMature = ivRank.count >= ivRank.needed && ivRank.percentile != null;
  if (ivMature) {
    return { label: "IV:", value: `${Math.round(ivRank.percentile!)}%ile` };
  }
  if (ivRank.hvPercentile != null) {
    return { label: "HV:", value: `${Math.round(ivRank.hvPercentile)}%ile` };
  }
  // Neither IV nor HV percentile is computable yet (e.g. too little
  // daily-close history at all for this ticker) -- the only honest
  // thing left to show is the literal building-history progress.
  return { label: "IV:", value: `${ivRank.count}d/${ivRank.needed}` };
}

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
  const vol = summary.data ? volatilityField(summary.data.ivRank) : null;

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
              {vol?.label}{" "}
              <span className="font-mono text-foreground">{vol?.value}</span>
            </span>
            <span>
              Max Pain:{" "}
              <span className="font-mono text-foreground">
                {summary.data.maxPainStrike ?? "—"}
              </span>
            </span>
            <span>
              P/C:{" "}
              <span className="font-mono text-foreground">
                {summary.data.putCallRatio != null ? summary.data.putCallRatio.toFixed(2) : "—"}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
