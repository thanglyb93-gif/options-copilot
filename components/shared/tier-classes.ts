/**
 * Entry Score tier -> Tailwind classes. The single source of truth for
 * this mapping going forward (Phase 41) -- components/ticker/entry-
 * score-panel.tsx and components/ticker/comparison-panel.tsx each still
 * carry their own pre-existing local copy of this exact same mapping;
 * new surfaces (like the Ranking table) import this one instead of
 * adding a third copy.
 */
export function tierClasses(tier: string): { text: string; border: string; bg: string } {
  if (tier.startsWith("SELL")) return { text: "text-accent", border: "border-accent/40", bg: "bg-accent/5" };
  if (tier === "CONSIDER SKIPPING") return { text: "text-yellow-400", border: "border-yellow-500/40", bg: "bg-yellow-500/5" };
  return { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/5" };
}
