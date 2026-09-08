/**
 * Classifies a batch of news headlines into a level (macro vs.
 * individual-company) and a category within that level. Batches 20-30
 * headlines into a single Anthropic structured-output call (same
 * tool-use pattern as lib/briefing.ts) rather than one call per
 * headline, to keep cost bounded. Pure prompt/schema/validation logic --
 * classifyHeadlines() is the only I/O in this module. Caching (so a
 * given headline is only ever classified once) lives in
 * lib/headline-classification-service.ts.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { generateStructuredOutput } from "./anthropic";

export type HeadlineLevel = "macro" | "individual";

export type MacroCategory = "monetary-policy" | "economic-data" | "geopolitical" | "regulatory";

export type IndividualCategory =
  | "earnings"
  | "M&A-buyback"
  | "analyst-action"
  | "executive-change"
  | "partnership"
  | "notable-investor-move"
  | "financing-event"
  | "new-to-watch"
  | "other";

export type HeadlineCategory = MacroCategory | IndividualCategory;

export const MACRO_CATEGORIES: readonly MacroCategory[] = [
  "monetary-policy",
  "economic-data",
  "geopolitical",
  "regulatory",
];

export const INDIVIDUAL_CATEGORIES: readonly IndividualCategory[] = [
  "earnings",
  "M&A-buyback",
  "analyst-action",
  "executive-change",
  "partnership",
  "notable-investor-move",
  "financing-event",
  "new-to-watch",
  "other",
];

/** Phase 33 -- only meaningful for category "financing-event". */
export type FinancingEventStatus = "announced" | "pricing" | "closing-settled";

export const FINANCING_EVENT_STATUSES: readonly FinancingEventStatus[] = [
  "announced",
  "pricing",
  "closing-settled",
];

/** Recommended batch size -- keeps a single call's output comfortably within budget while bounding call count. */
export const HEADLINE_CLASSIFICATION_BATCH_SIZE = 25;

export interface ClassifiableHeadline {
  /** Stable identifier -- see lib/headline-classification-service.ts's stableHeadlineId(). */
  id: string;
  headline: string;
  source: string;
  summary: string;
  publishedAt: string; // ISO
}

export interface HeadlineClassification {
  level: HeadlineLevel;
  category: HeadlineCategory;
  /** Phase 33 -- only set (and only meaningful) when category === "financing-event"; null when the status isn't determinable from the headline text. */
  financingStatus?: FinancingEventStatus | null;
  /** Phase 33 -- ISO date (YYYY-MM-DD) the headline states the financing event occurred/occurs, when stated; null otherwise. Only meaningful for "financing-event". */
  financingEventDate?: string | null;
}

export const HEADLINE_CLASSIFICATION_SYSTEM_PROMPT = `You classify financial news headlines for an options-trading dashboard. For each headline, decide:

1. LEVEL -- "macro" (policy, rates, broad economic data, geopolitical events, market-wide regulatory action) or "individual" (specific to one company or a small set of named companies).

2. CATEGORY, chosen from the set matching the level you picked:
   - macro: "monetary-policy" (Fed/central bank rates and commentary), "economic-data" (jobs, inflation, GDP, and other releases), "geopolitical" (conflicts, elections, trade/tariff actions), "regulatory" (market-wide rule or policy changes, not aimed at one company)
   - individual: "earnings" (results, guidance), "M&A-buyback" (mergers, acquisitions, buybacks), "analyst-action" (upgrades, downgrades, price targets), "executive-change" (CEO/CFO/leadership moves), "partnership" (deals, collaborations, contracts), "notable-investor-move" (13F filings, activist stakes, insider buying/selling), "financing-event" (debt or convertible-note offerings, share exchanges, secondary offerings, lockup expirations), "new-to-watch" (a company entering relevance for reasons not covered by the other categories -- e.g. an IPO, a new product launch, unusual volume), "other" (individual-company news that doesn't fit any category above)

For a headline classified "financing-event", also determine:
   - STATUS, from what the headline explicitly states: "announced" (a new offering/note/exchange is being announced), "pricing" (terms/pricing are being set), "closing-settled" (the deal has closed/settled/completed) -- or leave it unset if genuinely unclear from the text.
   - EVENT DATE, an explicit date (YYYY-MM-DD) mentioned in the headline or summary for when this occurred -- or leave it unset if no date is stated. Never infer a date that isn't actually written.
   These two fields are meaningless for every other category -- leave both unset unless the category is "financing-event".

Classify strictly from what the headline and summary actually say -- don't guess at implications not stated. Every headline gets exactly one level and one category from that level's set. Return your classifications in the same order as the input list, one per headline, each tagged with its 1-based index matching the numbered list.`;

export function buildClassificationPrompt(batch: ClassifiableHeadline[]): string {
  const lines = batch
    .map(
      (h, i) =>
        `${i + 1}. [${h.source}, ${h.publishedAt.slice(0, 10)}] ${h.headline}${
          h.summary ? ` -- ${h.summary}` : ""
        }`
    )
    .join("\n");

  return `Classify each of the following ${batch.length} headlines:\n\n${lines}\n\nEmit one classification per headline, in the same order, each carrying its 1-based index (1 through ${batch.length}).`;
}

export const CLASSIFY_HEADLINES_TOOL_NAME = "emit_headline_classifications";

const ALL_CATEGORIES = [...MACRO_CATEGORIES, ...INDIVIDUAL_CATEGORIES] as const;

const CLASSIFY_HEADLINES_INPUT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      description: "One entry per input headline, same order, each carrying its 1-based index.",
      items: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "1-based position of this headline in the numbered list shown in the prompt.",
          },
          level: { type: "string", enum: ["macro", "individual"] },
          category: { type: "string", enum: ALL_CATEGORIES as unknown as string[] },
          financingStatus: {
            type: "string",
            enum: FINANCING_EVENT_STATUSES as unknown as string[],
            description: "Only for category 'financing-event' -- omit for every other category, and omit when unclear.",
          },
          financingEventDate: {
            type: "string",
            description:
              "Only for category 'financing-event' -- an explicit YYYY-MM-DD date stated in the headline/summary. Omit for every other category, and omit when no date is stated.",
          },
        },
        required: ["index", "level", "category"],
      },
    },
  },
  required: ["classifications"],
};

function isValidCategoryForLevel(level: HeadlineLevel, category: string): category is HeadlineCategory {
  return level === "macro"
    ? (MACRO_CATEGORIES as readonly string[]).includes(category)
    : (INDIVIDUAL_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Validates and normalizes Claude's raw tool-call output into a Map keyed
 * by headline id, resolving each entry's echoed 1-based `index` back to
 * the real id via `batch` (the exact array sent in the prompt) -- indexes
 * are cheap for Claude to emit accurately and correctly, unlike asking it
 * to echo back a long id/URL verbatim (which previously blew the output
 * token budget and truncated the response for a full 25-headline batch of
 * long article URLs). A level/category mismatch (e.g. level "macro"
 * paired with an individual-only category) is corrected by trusting the
 * more specific signal -- the category -- and deriving level from it,
 * rather than discarding the whole entry; an entry with an out-of-range
 * index or a category outside both known sets is dropped (the caller
 * will simply re-classify that headline on a later request rather than
 * caching something meaningless).
 */
export function parseHeadlineClassifications(
  value: unknown,
  batch: ClassifiableHeadline[]
): Map<string, HeadlineClassification> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Headline classification response was not an object.");
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.classifications)) {
    throw new Error("Headline classification response had a malformed classifications array.");
  }

  const result = new Map<string, HeadlineClassification>();

  for (const entry of v.classifications) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.index !== "number" || typeof e.level !== "string" || typeof e.category !== "string") {
      continue;
    }
    const headline = batch[e.index - 1];
    if (!headline) continue;
    if (e.level !== "macro" && e.level !== "individual") continue;

    let level = e.level as HeadlineLevel;
    const category = e.category;

    if (!isValidCategoryForLevel(level, category)) {
      const derivedLevel: HeadlineLevel | null = (MACRO_CATEGORIES as readonly string[]).includes(category)
        ? "macro"
        : (INDIVIDUAL_CATEGORIES as readonly string[]).includes(category)
          ? "individual"
          : null;
      if (derivedLevel == null) continue;
      level = derivedLevel;
    }

    let financingStatus: FinancingEventStatus | null = null;
    let financingEventDate: string | null = null;
    if (category === "financing-event") {
      if (typeof e.financingStatus === "string" && (FINANCING_EVENT_STATUSES as readonly string[]).includes(e.financingStatus)) {
        financingStatus = e.financingStatus as FinancingEventStatus;
      }
      if (typeof e.financingEventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.financingEventDate)) {
        financingEventDate = e.financingEventDate;
      }
    }

    result.set(headline.id, { level, category: category as HeadlineCategory, financingStatus, financingEventDate });
  }

  return result;
}

/**
 * Classifies one batch (recommended: HEADLINE_CLASSIFICATION_BATCH_SIZE
 * headlines) via a single Anthropic call. The only I/O in this module.
 */
export async function classifyHeadlines(
  batch: ClassifiableHeadline[]
): Promise<Map<string, HeadlineClassification>> {
  if (batch.length === 0) return new Map();

  const userPrompt = buildClassificationPrompt(batch);

  const output = await generateStructuredOutput({
    toolName: CLASSIFY_HEADLINES_TOOL_NAME,
    toolDescription: "Emits the level + category classification for each input headline.",
    inputSchema: CLASSIFY_HEADLINES_INPUT_SCHEMA,
    systemPrompt: HEADLINE_CLASSIFICATION_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 4096,
  });

  return parseHeadlineClassifications(output, batch);
}
