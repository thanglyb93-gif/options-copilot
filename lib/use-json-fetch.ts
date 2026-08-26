"use client";

import { useEffect, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Fetches and JSON-decodes `url`, re-fetching whenever it changes. */
export function useJsonFetch<T>(url: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState({ data: null, loading: true, error: null });

    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setState({
            data: null,
            loading: false,
            error: body?.error ?? `Request failed (${res.status})`,
          });
          return;
        }
        setState({ data: body as T, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Request failed",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
