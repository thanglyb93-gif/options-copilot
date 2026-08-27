"use client";

import { useEffect, useState } from "react";
import type { BriefingResponse } from "@/types/api";
import type { FetchState } from "@/lib/use-json-fetch";
import type { EarningsResponse } from "@/types/api";
import { formatRelativeTime } from "@/lib/format";
import { composeMarketRead } from "@/lib/market-read";
import { SkeletonLines, ErrorNote } from "./section";

export function MarketReadPanel({
  symbol,
  earningsState,
}: {
  symbol: string;
  earningsState: FetchState<EarningsResponse>;
}) {
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

  const composed =
    data && earningsState.data ? composeMarketRead(data.content, earningsState.data) : null;

  const stillLoading = loading || earningsState.loading;

  return (
    <div className="flex flex-col gap-3">
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

      {stillLoading && <SkeletonLines count={4} />}
      {error && <ErrorNote message={error} />}
      {earningsState.error && <ErrorNote message={earningsState.error} />}

      {composed && data && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            {composed.cooldownFlagged && (
              <span
                className="mt-0.5 shrink-0 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-300"
                title="Price has moved sharply over the last 10 trading days"
              >
                ⚠ cooldown
              </span>
            )}
            <p className="text-sm leading-relaxed text-foreground">
              {composed.sentences.join(" ")}
            </p>
          </div>

          <p className="border-t border-border pt-3 text-sm font-semibold leading-relaxed text-foreground">
            <span className="text-accent">Net read:</span> {composed.netRead}
          </p>

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
