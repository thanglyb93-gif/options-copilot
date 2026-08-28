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
  "new-to-watch",
  "other",
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
}

export const HEADLINE_CLASSIFICATION_SYSTEM_PROMPT = `You classify financial news headlines for an options-trading dashboard. For each headline, decide:

1. LEVEL -- "macro" (policy, rates, broad economic data, geopolitical events, market-wide regulatory action) or "individual" (specific to one company or a small set of named companies).

2. CATEGORY, chosen from the set matching the level you picked:
   - macro: "monetary-policy" (Fed/central bank rates and commentary), "economic-data" (jobs, inflation, GDP, and other releases), "geopolitical" (conflicts, elections, trade/tariff actions), "regulatory" (market-wide rule or policy changes, not aimed at one company)
   - individual: "earnings" (results, guidance), "M&A-buyback" (mergers, acquisitions, buybacks), "analyst-action" (upgrades, downgrades, price targets), "executive-change" (CEO/CFO/leadership moves), "partnership" (deals, collaborations, contracts), "notable-investor-move" (13F filings, activist stakes, insider buying/selling), "new-to-watch" (a company entering relevance for reasons not covered by the other categories -- e.g. an IPO, a new product launch, unusual volume), "other" (individual-company news that doesn't fit any category above)

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

    result.set(headline.id, { level, category: category as HeadlineCategory });
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
