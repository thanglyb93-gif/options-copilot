"use client";

/**
 * Phase 33 -- warning icon for Timing Caution (lib/timing-caution.ts),
 * rendered directly adjacent to Entry Score digits wherever they appear.
 * Same red visual tier as the existing directional-opposition warning
 * (entry-score-panel.tsx) -- this is a parallel signal, never a change to
 * the score number itself, which always renders unchanged regardless of
 * whether this fires. Click/tap expands the full reasoning list with
 * actual values.
 */

import { useState } from "react";
import type { TimingCautionResult } from "@/types/api";

export function TimingCautionIcon({ timingCaution }: { timingCaution: TimingCautionResult | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!timingCaution?.active) return null;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Timing Caution -- tap for details"
        title="Timing Caution -- this ticker may not have finished digesting a recent event/move. Tap for details."
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-red-500/60 bg-red-500/15 text-xs font-bold leading-none text-red-300"
      >
        ⚠
      </button>
      {expanded && (
        <div className="absolute left-0 top-full z-10 mt-1.5 w-72 rounded-md border border-red-500/60 bg-surface p-3 text-left shadow-lg">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-300">Timing Caution</p>
          <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-foreground">
            {timingCaution.reasoning.map((reason, i) => (
              <li key={i}>• {reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted">
            Whether this has settled down yet -- not a prediction of what happens next.
          </p>
        </div>
      )}
    </span>
  );
}
