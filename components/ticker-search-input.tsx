"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchMatch, SearchResponse } from "@/types/api";

/**
 * Debounced ticker/company search + dropdown, shared by the Dashboard's
 * "add to watchlist" search and the Positions form's ticker field --
 * the search/autocomplete UX is identical, only what happens on
 * selection differs, so that's the one pluggable piece.
 */
export function TickerSearchInput({
  onSelect,
  placeholder = "Search by ticker or company name (e.g. NVDA, nvidia)",
  busy = false,
  clearOnSelect = true,
}: {
  onSelect: (match: SearchMatch) => void;
  placeholder?: string;
  busy?: boolean;
  /** false keeps the selected symbol in the input instead of clearing it -- useful in a form field. */
  clearOnSelect?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recently *requested* query so an out-of-order response
  // from an earlier keystroke can't clobber a newer one.
  const latestQueryRef = useRef("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
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

  function select(match: SearchMatch) {
    onSelect(match);
    if (clearOnSelect) {
      setQuery("");
      setMatches([]);
    } else {
      setQuery(match.symbol);
    }
    setOpen(false);
  }

  function selectRaw(raw: string) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return;
    select({ symbol, name: symbol, quoteType: "EQUITY" });
  }

  return (
    <div className="relative flex flex-col gap-1">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => matches.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            e.preventDefault();
            if (matches.length > 0) select(matches[0]);
            else selectRaw(query);
          }
        }}
        placeholder={placeholder}
        disabled={busy}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />

      {open && matches.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 w-full max-w-md rounded-md border border-border bg-surface shadow-lg">
          {matches.map((match) => (
            <li key={match.symbol}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(match)}
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
    </div>
  );
}
