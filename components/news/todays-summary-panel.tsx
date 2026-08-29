"use client";

import type { TodaysSummaryResponse } from "@/types/api";
import { formatRelativeTime } from "@/lib/format";
import { composeTodaysSummary } from "@/lib/todays-summary-read";
import { SkeletonLines, ErrorNote } from "@/components/ticker/section";

export function TodaysSummaryPanel({
  data,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  data: TodaysSummaryResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const composed = data ? composeTodaysSummary(data.content) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        {data && (
          <span className="text-xs text-muted">
            Updated {formatRelativeTime(data.generatedAt)}
            {data.cached ? " (cached)" : ""}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || loading}
          className="ml-auto min-h-11 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50 lg:min-h-0"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && <SkeletonLines count={4} />}
      {error && <ErrorNote message={error} />}

      {composed && (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-foreground">{composed.sentences.join(" ")}</p>

          <p className="border-t border-border pt-3 text-sm font-semibold leading-relaxed text-foreground">
            <span className="text-accent">Net read:</span> {composed.netRead}
          </p>
        </div>
      )}
    </div>
  );
}
