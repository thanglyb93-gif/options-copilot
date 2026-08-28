"use client";

import { useJsonFetch } from "@/lib/use-json-fetch";
import { SkeletonLines, ErrorNote } from "@/components/ticker/section";
import type { LeanAccuracyResponse } from "@/app/api/lean-accuracy/route";

/**
 * Purely informational read on whether the briefing's directionalLean
 * (lib/briefing.ts) has actually been calling stocks correctly -- not a
 * gate on anything else in the app. Needs several weeks of briefings
 * regenerating (see lib/briefing-service.ts's recordLeanHistory) and the
 * resolve job (/api/lean-resolve) running before the numbers mean
 * anything, so the zero/low-data states are treated as normal, not errors.
 */
export function LeanAccuracySummary() {
  const { data, loading, error } = useJsonFetch<LeanAccuracyResponse>("/api/lean-accuracy");

  if (loading) return <SkeletonLines count={2} />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  if (data.tracked === 0) {
    return (
      <p className="text-sm text-muted">
        Directional lean accuracy: no resolved leans yet
        {data.pending > 0 ? ` (${data.pending} pending, resolving ~10 trading days after each briefing)` : ""}
        . This needs several weeks of briefings to accumulate before it means anything.
      </p>
    );
  }

  const pct = data.heldUpPct != null ? Math.round(data.heldUpPct) : null;

  return (
    <p className="text-sm text-foreground">
      Directional lean accuracy, last {data.windowDays} days:{" "}
      <span className="font-mono">{data.tracked}</span> tracked,{" "}
      {pct != null ? <span className="font-mono">{pct}%</span> : "—"} held up{" "}
      <span className="text-muted">
        ({data.heldUp} held up / {data.reversed} reversed / {data.unclear} unclear
        {data.pending > 0 ? `, ${data.pending} pending` : ""})
      </span>
    </p>
  );
}
