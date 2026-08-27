"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchMatch, SearchResponse, WatchlistRow } from "@/types/api";

export function SearchBar({ onAdd }: { onAdd: (row: WatchlistRow) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recently *requested* query so an out-of-order response
  // from an earlier keystroke can't clobber a newer one.
  const latestQueryRef = useRef("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    // Clear stale matches immediately -- otherwise Enter can act on the
    // previous query's top result while this one is still debouncing.
    setMatches([]);

    if (trimmed.length < 1) {
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      latestQueryRef.current = trimmed;
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((body: SearchResponse) => {
          if (latestQueryRef.current !== trimmed) return; // superseded
          setMatches(body.matches ?? []);
          setOpen(true);
        })
        .catch(() => {
          if (latestQueryRef.current === trimmed) setMatches([]);
        })
        .finally(() => {
          if (latestQueryRef.current === trimmed) setSearching(false);
        });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function addTicker(ticker: string) {
    const symbol = ticker.trim().toUpperCase();
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
      setQuery("");
      setMatches([]);
      setOpen(false);
    } catch {
      setError(`Couldn't add ${symbol}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="relative flex flex-col gap-1">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        onFocus={() => matches.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            if (matches.length > 0) {
              addTicker(matches[0].symbol);
            } else {
              addTicker(query);
            }
          }
        }}
        placeholder="Search by ticker or company name (e.g. NVDA, nvidia)"
        disabled={adding}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />

      {open && matches.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 w-full max-w-md rounded-md border border-border bg-surface shadow-lg">
          {matches.map((match) => (
            <li key={match.symbol}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTicker(match.symbol)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/5"
              >
                <span className="font-mono text-foreground">{match.symbol}</span>
                <span className="truncate text-muted">{match.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searching && <p className="text-xs text-muted">Searching…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
