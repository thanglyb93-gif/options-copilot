import type { Suitability } from "@/types/api";

/**
 * Deliberately distinct from the Entry Score tier badges (green/yellow/
 * red, rounded-rectangle) -- this is a different kind of judgment
 * (historical relative performance, not a trade-entry recommendation),
 * so it gets its own color family (teal/slate/rose, none used by Entry
 * Score or the importance-tier badges) and a pill shape with a
 * direction icon instead of a bordered rectangle.
 */
const STYLE: Record<Suitability, { label: string; icon: string; text: string; border: string; bg: string }> = {
  outperforming: { label: "Outperforming", icon: "▲", text: "text-teal-300", border: "border-teal-500/40", bg: "bg-teal-500/10" },
  inline: { label: "In Line", icon: "▬", text: "text-slate-300", border: "border-slate-500/40", bg: "bg-slate-500/10" },
  underperforming: { label: "Underperforming", icon: "▼", text: "text-rose-300", border: "border-rose-500/40", bg: "bg-rose-500/10" },
};

export function SuitabilityBadge({ suitability }: { suitability: Suitability }) {
  const style = STYLE[suitability];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border ${style.border} ${style.bg} px-3 py-1 text-sm font-medium ${style.text}`}
    >
      <span>{style.icon}</span>
      {style.label}
    </span>
  );
}
