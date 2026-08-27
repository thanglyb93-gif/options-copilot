"use client";

import { useEffect, useState } from "react";
import type { BriefingResponse } from "@/types/api";
import { formatRelativeTime } from "@/lib/format";
import { SkeletonLines, ErrorNote } from "./section";

export function BriefingPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load(forceRefresh: boolean) {
    const setBusy = forceRefresh ? setRefreshing : setLoading;
    setBusy(true);
    setError(null);

    fetch(`/api/briefing/${symbol}${forceRefresh ? "?refresh=1" : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error ?? `Request failed (${res.status})`);
          return;
        }
        setData(body as BriefingResponse);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed"))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {data && (
          <span className="text-xs text-muted">
            Updated {formatRelativeTime(data.generatedAt)}
          </span>
        )}
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && <SkeletonLines count={4} />}
      {error && <ErrorNote message={error} />}

      {data && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {data.content.bullets.map((bullet, i) => (
              <li key={i} className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                    {bullet.source}
                  </span>
                  <p className="text-sm text-foreground">{bullet.fact}</p>
                </div>
                <p className="pl-1 text-sm text-muted">{bullet.impact}</p>
              </li>
            ))}
          </ul>

          {data.content.macro && (
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                Macro backdrop
              </span>
              <p className="mt-1 text-sm text-foreground">{data.content.macro}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
