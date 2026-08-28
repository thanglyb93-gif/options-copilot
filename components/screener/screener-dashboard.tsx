"use client";

import { useState } from "react";
import type { SearchMatch, ScreenerResponse, WatchlistRow } from "@/types/api";
import { TickerSearchInput } from "@/components/ticker-search-input";
import { ScreenerResultCard } from "./screener-result-card";

interface WatchlistAddState {
  adding: boolean;
  added: boolean;
  error: string | null;
}

export function ScreenerDashboard() {
  const [results, setResults] = useState<ScreenerResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addState, setAddState] = useState<Record<string, WatchlistAddState>>({});

  async function checkTicker(match: SearchMatch) {
    const symbol = match.symbol.trim().toUpperCase();
    if (!symbol) return;

    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/screener/${symbol}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFetchError(body?.error ?? `Couldn't evaluate ${symbol}`);
        return;
      }
      const data = body as ScreenerResponse;
      // Re-checking a ticker already in the session moves its fresh
      // result to the top rather than duplicating the card.
      setResults((prev) => [data, ...prev.filter((r) => r.ticker !== data.ticker)]);
    } catch {
      setFetchError(`Couldn't evaluate ${symbol}`);
    } finally {
      setLoading(false);
    }
  }

  async function addToWatchlist(ticker: string) {
    setAddState((prev) => ({ ...prev, [ticker]: { adding: true, added: false, error: null } }));
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setAddState((prev) => ({
          ...prev,
          [ticker]: { adding: false, added: false, error: body?.error ?? `Couldn't add ${ticker}` },
        }));
        return;
      }
      const row = body.watchlist as WatchlistRow;
      setAddState((prev) => ({ ...prev, [row.ticker]: { adding: false, added: true, error: null } }));
    } catch {
      setAddState((prev) => ({
        ...prev,
        [ticker]: { adding: false, added: false, error: `Couldn't add ${ticker}` },
      }));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">Screener</h1>
        <p className="text-sm text-muted">
          Evaluate a candidate stock&rsquo;s relative strength against the broad market and its sector peers
          before adding it to the watchlist -- check several before committing to one.
        </p>
        <TickerSearchInput
          onSelect={checkTicker}
          busy={loading}
          clearOnSelect={false}
          placeholder="Search by ticker or company name to evaluate (e.g. CRDO, credo)"
        />
      </div>

      {loading && <p className="text-sm text-muted">Evaluating…</p>}
      {fetchError && <p className="text-sm text-red-400">{fetchError}</p>}

      {results.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">Search for a ticker above to evaluate it.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {results.map((data) => {
          const state = addState[data.ticker] ?? { adding: false, added: false, error: null };
          return (
            <ScreenerResultCard
              key={data.ticker}
              data={data}
              onAddToWatchlist={() => addToWatchlist(data.ticker)}
              adding={state.adding}
              added={state.added}
              addError={state.error}
            />
          );
        })}
      </div>
    </div>
  );
}
