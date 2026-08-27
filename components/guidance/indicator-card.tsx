"use client";

import { useState } from "react";
import type { GuidanceIndicator } from "@/lib/guidance-content";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <p className="mt-0.5 text-sm text-foreground">{value}</p>
    </div>
  );
}

export function IndicatorCard({ indicator }: { indicator: GuidanceIndicator }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      id={indicator.id}
      className="scroll-mt-20 rounded-lg border border-border bg-background"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{indicator.name}</span>
          {indicator.status === "planned" && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              Planned
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted">{expanded ? "Hide" : "Expand"}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <Field label="What it measures" value={indicator.whatItMeasures} />
          <Field label="How it's calculated" value={indicator.howCalculated} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="High reading" value={indicator.interpretHigh} />
            <Field label="Low reading" value={indicator.interpretLow} />
          </div>
          <Field label="Where it appears" value={indicator.whereItAppears} />
        </div>
      )}
    </div>
  );
}
