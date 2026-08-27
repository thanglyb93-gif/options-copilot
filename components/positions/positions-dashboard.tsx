"use client";

import { useCallback, useEffect, useState } from "react";
import type { PositionsListResponse, PositionSummary } from "@/types/api";
import { SkeletonLines, ErrorNote } from "@/components/ticker/section";
import { AddPositionForm } from "./add-position-form";
import { PositionCard } from "./position-card";
import { ClosedPositionRow } from "./closed-position-row";

export function PositionsDashboard() {
  const [positions, setPositions] = useState<PositionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => {
    fetch("/api/positions")
      .then((res) => res.json())
      .then((body: PositionsListResponse) => setPositions(body.positions ?? []))
      .catch(() => setError("Couldn't load positions"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = (positions ?? []).filter((p) => p.status === "open");
  const closed = (positions ?? []).filter((p) => p.status !== "open");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">Positions</h1>
        <AddPositionForm onAdded={load} />
      </div>

      {error && <ErrorNote message={error} />}
      {positions == null && !error && <SkeletonLines count={4} />}

      {positions != null && open.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">No open positions. Log one above to get started.</p>
        </div>
      )}

      {open.length > 0 && (
        <div className="flex flex-col gap-4">
          {open.map((p) => (
            <PositionCard key={p.id} position={p} onChanged={load} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="flex w-fit items-center gap-2 text-sm font-medium text-muted hover:text-foreground"
          >
            {showClosed ? "▾" : "▸"} Closed Positions ({closed.length})
          </button>
          {showClosed && (
            <div className="rounded-lg border border-border bg-surface p-4">
              {closed.map((p) => (
                <ClosedPositionRow key={p.id} position={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
