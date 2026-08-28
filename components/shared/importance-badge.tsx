import type { ImportanceTier } from "@/lib/guidance-content";
import { IMPORTANCE_TIER_DESCRIPTIONS } from "@/lib/guidance-content";

/**
 * Single source of truth for how each importance tier looks -- both the
 * Guidance page's glossary badges and every inline badge elsewhere in the
 * app render through this same component/map, so a given indicator's
 * tier always shows the same color and label everywhere it appears.
 * Blue/violet-family tones deliberately chosen to read as neutral
 * "weight" indicators, distinct from the app's existing semantic colors
 * (green/accent = gain, red = loss, amber = warning).
 */
const TIER_STYLES: Record<
  ImportanceTier,
  { label: string; dot: string; text: string; border: string; bg: string }
> = {
  core: {
    label: "Core",
    dot: "bg-violet-400",
    text: "text-violet-300",
    border: "border-violet-500/40",
    bg: "bg-violet-500/10",
  },
  supporting: {
    label: "Supporting",
    dot: "bg-blue-400",
    text: "text-blue-300",
    border: "border-blue-500/40",
    bg: "bg-blue-500/10",
  },
  context: {
    label: "Context",
    dot: "bg-sky-400",
    text: "text-sky-300",
    border: "border-sky-500/40",
    bg: "bg-sky-500/10",
  },
};

export function ImportanceBadge({ tier, className = "" }: { tier: ImportanceTier; className?: string }) {
  const style = TIER_STYLES[tier];
  return (
    <span
      title={IMPORTANCE_TIER_DESCRIPTIONS[tier]}
      className={`inline-flex w-fit shrink-0 items-center gap-1 rounded border ${style.border} ${style.bg} px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${style.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

export function ImportanceTierLegend() {
  const tiers: ImportanceTier[] = ["core", "supporting", "context"];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2.5">
      <span className="text-[11px] uppercase tracking-wide text-muted">Importance key</span>
      <div className="flex flex-col gap-1.5">
        {tiers.map((tier) => (
          <div key={tier} className="flex items-baseline gap-2 text-xs">
            <ImportanceBadge tier={tier} />
            <span className="text-muted">{IMPORTANCE_TIER_DESCRIPTIONS[tier]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
