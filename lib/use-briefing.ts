"use client";

import { useEffect, useState } from "react";
import type { BriefingResponse } from "@/types/api";
import type { FetchState } from "./use-json-fetch";

export interface BriefingFetchState extends FetchState<BriefingResponse> {
  refreshing: boolean;
  refresh: () => void;
}

/**
 * Shared fetch for a ticker's Market Read briefing, lifted out of
 * MarketReadPanel so it's called exactly once per ticker page load.
 * components/ticker/quote-header.tsx's Recent Analyst Actions reads the
 * SAME response (analystActions is part of the same BriefingContent) --
 * before this hook existed, each fired its own independent request for
 * identical data. That mattered more than ordinary duplicate-fetch waste
 * once Phase 43's daily generation cap landed: two near-simultaneous
 * requests against a stale cache could each see "cap not yet hit" and
 * both trigger a real generation, double-counting against the shared
 * daily limit for a single page view. One shared fetch means one
 * generation attempt, not two.
 */
export function useBriefing(symbol: string): BriefingFetchState {
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

  return { data, loading, error, refreshing, refresh: () => load(true) };
}
