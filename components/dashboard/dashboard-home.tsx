"use client";

import { useEffect, useState } from "react";
import type { WatchlistListResponse, WatchlistRow } from "@/types/api";
import { SearchBar } from "./search-bar";
import { WatchlistCard } from "./watchlist-card";
import { IvHealthBanner } from "./iv-health-banner";

export function DashboardHome() {
  const [rows, setRows] = useState<WatchlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/watchlist")
      .then((res) => res.json())
      .then((body: WatchlistListResponse) => setRows(body.watchlist ?? []))
      .catch(() => setError("Couldn't load watchlist"));
  }, []);

  function addRow(row: WatchlistRow) {
    setRows((prev) => [row, ...(prev ?? [])]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <IvHealthBanner />

      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <SearchBar onAdd={addRow} />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {rows == null && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      )}

      {rows != null && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">
            Your watchlist is empty. Search for a ticker above to get started.
          </p>
        </div>
      )}

      {rows != null && rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <WatchlistCard key={row.id} row={row} onRemove={removeRow} />
          ))}
        </div>
      )}
    </div>
  );
}
