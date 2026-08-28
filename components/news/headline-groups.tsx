"use client";

import { useState } from "react";
import type { ClassifiedNewsHeadline, HeadlineCategory } from "@/types/api";
import { formatRelativeTime } from "@/lib/format";
import { Section } from "@/components/ticker/section";

const CATEGORY_LABELS: Record<HeadlineCategory, string> = {
  "monetary-policy": "Monetary Policy",
  "economic-data": "Economic Data",
  geopolitical: "Geopolitical",
  regulatory: "Regulatory",
  earnings: "Earnings",
  "M&A-buyback": "M&A / Buybacks",
  "analyst-action": "Analyst Actions",
  "executive-change": "Executive Changes",
  partnership: "Partnerships",
  "notable-investor-move": "Notable Investor Moves",
  "new-to-watch": "New to Watch",
  other: "Other",
};

function sortNewestFirst(headlines: ClassifiedNewsHeadline[]): ClassifiedNewsHeadline[] {
  return headlines
    .slice()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

interface CategoryGroup {
  category: HeadlineCategory;
  headlines: ClassifiedNewsHeadline[];
}

/** Groups by category, headlines newest-first within each group, groups ordered by their own newest headline. */
function groupByCategory(headlines: ClassifiedNewsHeadline[]): CategoryGroup[] {
  const byCategory = new Map<HeadlineCategory, ClassifiedNewsHeadline[]>();
  for (const h of headlines) {
    const list = byCategory.get(h.category) ?? [];
    list.push(h);
    byCategory.set(h.category, list);
  }

  const groups: CategoryGroup[] = Array.from(byCategory.entries()).map(([category, list]) => ({
    category,
    headlines: sortNewestFirst(list),
  }));

  groups.sort(
    (a, b) => new Date(b.headlines[0].publishedAt).getTime() - new Date(a.headlines[0].publishedAt).getTime()
  );

  return groups;
}

function HeadlineRow({ headline }: { headline: ClassifiedNewsHeadline }) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {CATEGORY_LABELS[headline.category]}
        </span>
        <a
          href={headline.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-foreground hover:underline"
        >
          {headline.headline}
        </a>
      </div>
      <span className="text-xs text-muted">
        {headline.source} · {formatRelativeTime(headline.publishedAt)}
      </span>
    </li>
  );
}

function CategoryGroupPanel({ group }: { group: CategoryGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-fit items-center gap-2 text-sm font-medium text-muted hover:text-foreground"
      >
        {expanded ? "▾" : "▸"} {CATEGORY_LABELS[group.category]} ({group.headlines.length})
      </button>
      {expanded && (
        <ul className="flex flex-col gap-3 border-l border-border pl-3">
          {group.headlines.map((h) => (
            <HeadlineRow key={h.id} headline={h} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function HeadlineLevelSection({
  title,
  headlines,
}: {
  title: string;
  headlines: ClassifiedNewsHeadline[];
}) {
  const groups = groupByCategory(headlines);

  return (
    <Section title={`${title} (${headlines.length})`}>
      {headlines.length === 0 ? (
        <p className="text-sm text-muted">No headlines in this category today.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <CategoryGroupPanel key={g.category} group={g} />
          ))}
        </div>
      )}
    </Section>
  );
}
