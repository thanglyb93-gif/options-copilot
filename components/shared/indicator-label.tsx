/**
 * Small plain-language label pill for Phase 28's indicator labeling
 * (lib/indicator-labels.ts) -- deliberately neutral styling (not
 * green/red good-bad coded), since a label like "Rich" or "High Risk"
 * describes where a number sits, not whether that's good or bad for the
 * trade. Distinct from ImportanceBadge (which colors by decision weight,
 * not by value) and from tier badges (which really do mean good/bad).
 */
export function IndicatorLabel({ text }: { text: string }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center rounded border border-border bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/80">
      {text}
    </span>
  );
}

/** Same slot as IndicatorLabel, but for a data-quality caution rather than a descriptive band. */
export function CautionLabel({ text }: { text: string }) {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
      ⚠ {text}
    </span>
  );
}
