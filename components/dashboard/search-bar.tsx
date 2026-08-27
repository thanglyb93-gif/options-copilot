"use client";

import { useState } from "react";
import type { SearchMatch, WatchlistRow } from "@/types/api";
import { TickerSearchInput } from "@/components/ticker-search-input";

export function SearchBar({ onAdd }: { onAdd: (row: WatchlistRow) => void }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addTicker(match: SearchMatch) {
    const symbol = match.symbol.trim().toUpperCase();
    if (!symbol) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: symbol }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Couldn't add ${symbol}`);
        return;
      }
      onAdd(body.watchlist);
    } catch {
      setError(`Couldn't add ${symbol}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <TickerSearchInput onSelect={addTicker} busy={adding} />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
