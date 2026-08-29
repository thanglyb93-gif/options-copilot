/**
 * Builds the prompt for the per-ticker market intelligence briefing and
 * validates Claude's structured response. Prompt construction and output
 * validation are pure/no I/O; generateBriefing() is the only part that
 * calls out to the Anthropic API.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { generateStructuredOutput } from "./anthropic";

export interface BriefingHeadline {
  headline: string;
  source: string;
  summary: string;
  publishedAt: string; // ISO
}

export interface BriefingInputs {
  ticker: string;
  quote: {
    price: number | null;
    dayChangePercent: number | null;
    fiftyTwoWeekHigh: number | null;
    percentFrom52wHigh: number | null;
  };
  earnings: {
    nextEarningsDate: string | null;
    daysUntilEarnings: number | null;
    earningsCooldownFlagged: boolean;
    percentMoveLast10TradingDays: number | null;
  };
  trendDescription: string;
  companyHeadlines: BriefingHeadline[];
  marketHeadlines: BriefingHeadline[];
}

export interface BriefingBullet {
  fact: string;
  source: string;
  impact: string;
}

export type DirectionalLean = "bullish" | "neutral" | "bearish" | "mixed";

export interface DirectionalLeanResult {
  lean: DirectionalLean;
  rationale: string;
}

export type AnalystActionType = "raised" | "lowered" | "maintained" | "initiated" | "other";

/**
 * A single named-firm price-target action (Phase 31), extracted from the
 * same gathered headlines the bullets are built from -- distinct from
 * Part A's Yahoo-aggregated consensus target (lib/yahoo.ts's
 * AnalystTargets): this is individual, news-derived, and only as
 * complete as what the gathered headlines happened to mention. Only
 * emitted when a firm name is actually present in a source; priceTarget
 * is null when the source names the firm/action but doesn't state a
 * specific dollar figure.
 */
export interface AnalystAction {
  firm: string;
  action: AnalystActionType;
  priceTarget: number | null;
  date: string;
  source: string;
}

export interface BriefingContent {
  bullets: BriefingBullet[];
  macro?: string;
  directionalLean: DirectionalLeanResult;
  analystActions: AnalystAction[];
}

export const BRIEFING_SYSTEM_PROMPT = `You are a market intelligence analyst producing a condensed briefing for an options trader who is evaluating covered calls and cash-secured puts on one stock. Your only job is to summarize what the provided sources actually say and note the likely relevance to that specific decision.

Strict rules:
- Only state what the provided headlines and data actually say. Do not speculate, infer motives, or add information not present in the sources.
- If two sources conflict, say so explicitly in the relevant bullet rather than picking one.
- Every bullet's "impact" must be specific to this stock or to a covered-call/cash-secured-put decision on it (e.g. how it might affect near-term volatility, the earnings-cooldown window, or willingness to hold through assignment) -- never generic filler like "this could be important" or "investors should watch this."
- Produce 3 to 6 bullets. Prioritize the most decision-relevant, recent items over older or minor ones.
- Only include a macro note if a general market headline (Fed policy, inflation data, jobs reports, etc) is genuinely relevant to this ticker's sector or situation. If nothing qualifies, omit it entirely -- do not force a macro note into every briefing.

You must also synthesize a directional lean for the stock over the coming weeks, based solely on the weight of evidence in the gathered news, analyst commentary, and macro context:
- "bullish" if the evidence points toward the stock rising
- "bearish" if it points toward the stock falling
- "mixed" if the evidence genuinely conflicts (some sources bullish, some bearish, no clear majority)
- "neutral" if there is no clear signal either way, or the available sources are too thin to support a view
Give a one-to-two sentence rationale grounded in the same sources as your bullets. Do not force a bullish or bearish call when the evidence is thin or conflicting -- "neutral" or "mixed" with an honest rationale is the correct answer in that case, not a guess.

Finally, extract any SPECIFIC named-firm analyst actions mentioned in the gathered headlines (a firm raising, lowering, maintaining, or initiating coverage with a rating or price target on this stock) into analystActions:
- Only include an entry when a specific firm name is actually stated in a source (e.g. "Scotiabank", "Citigroup", "Piper Sandler") -- never infer or guess a firm.
- priceTarget is the specific dollar figure only if one is explicitly stated; use null if the source mentions the firm/action but no specific number.
- action is "raised" (increased an existing target), "lowered" (decreased one), "maintained" (reiterated an existing rating/target without a stated change), "initiated" (started coverage), or "other" for anything that doesn't cleanly fit those.
- date is the date of the action if stated, otherwise the source headline's own published date.
- source is the headline's source name, same as you'd cite in a bullet.
- If no headline mentions a specific named-firm action, return an empty array -- do not fabricate one to fill the field.`;

export function formatHeadlines(headlines: BriefingHeadline[]): string {
  if (headlines.length === 0) return "(none available)";
  return headlines
    .map(
      (h, i) =>
        `${i + 1}. [${h.source}, ${h.publishedAt.slice(0, 10)}] ${h.headline}${
          h.summary ? ` -- ${h.summary}` : ""
        }`
    )
    .join("\n");
}

/** Builds the user-message prompt from structured inputs. Pure, no I/O. */
export function buildBriefingPrompt(inputs: BriefingInputs): string {
  const { ticker, quote, earnings, trendDescription, companyHeadlines, marketHeadlines } = inputs;

  return `Ticker: ${ticker}

Current data:
- Price: ${quote.price ?? "unknown"}, day change: ${quote.dayChangePercent ?? "unknown"}%
- ${quote.percentFrom52wHigh ?? "unknown"}% from 52-week high (${quote.fiftyTwoWeekHigh ?? "unknown"})
- Trend: ${trendDescription}
- Next earnings: ${earnings.nextEarningsDate ?? "unknown"} (${earnings.daysUntilEarnings ?? "unknown"} days away)
- Earnings-cooldown flag: ${earnings.earningsCooldownFlagged ? "ACTIVE" : "not active"}${
    earnings.percentMoveLast10TradingDays != null
      ? ` (price moved ${earnings.percentMoveLast10TradingDays.toFixed(1)}% over the last 10 trading days)`
      : ""
  }

Company-specific headlines:
${formatHeadlines(companyHeadlines)}

General market headlines:
${formatHeadlines(marketHeadlines)}

Produce the briefing now, following the rules in your system prompt.`;
}

export const BRIEFING_TOOL_NAME = "emit_briefing";

const BRIEFING_INPUT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    bullets: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The fact, stated plainly, grounded in a source." },
          source: {
            type: "string",
            description: "The source's name (e.g. 'Reuters', 'Finnhub', 'Benzinga').",
          },
          impact: {
            type: "string",
            description:
              "One sentence on likely impact to the stock or to a covered-call/cash-secured-put decision specifically.",
          },
        },
        required: ["fact", "source", "impact"],
      },
    },
    macro: {
      type: "string",
      description:
        "Optional short macro backdrop note, included only if genuinely relevant to this ticker.",
    },
    directionalLean: {
      type: "object",
      properties: {
        lean: {
          type: "string",
          enum: ["bullish", "neutral", "bearish", "mixed"],
          description: "The weight-of-evidence directional lean for the coming weeks.",
        },
        rationale: {
          type: "string",
          description: "One to two sentences grounding the lean in the sources above.",
        },
      },
      required: ["lean", "rationale"],
    },
    analystActions: {
      type: "array",
      description: "Named-firm analyst actions found in the gathered headlines. Empty array if none.",
      items: {
        type: "object",
        properties: {
          firm: { type: "string", description: "The analyst firm's name, exactly as stated in the source." },
          action: {
            type: "string",
            enum: ["raised", "lowered", "maintained", "initiated", "other"],
          },
          priceTarget: {
            type: ["number", "null"],
            description: "The specific dollar price target, or null if the source didn't state one.",
          },
          date: { type: "string", description: "Date of the action, or the source headline's published date." },
          source: { type: "string", description: "The headline's source name (e.g. 'Benzinga', 'Reuters')." },
        },
        required: ["firm", "action", "priceTarget", "date", "source"],
      },
    },
  },
  required: ["bullets", "directionalLean", "analystActions"],
};

function isBullet(value: unknown): value is BriefingBullet {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fact === "string" && typeof v.source === "string" && typeof v.impact === "string"
  );
}

const VALID_LEANS: readonly DirectionalLean[] = ["bullish", "neutral", "bearish", "mixed"];

function isDirectionalLean(value: unknown): value is DirectionalLeanResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lean === "string" &&
    (VALID_LEANS as readonly string[]).includes(v.lean) &&
    typeof v.rationale === "string"
  );
}

const VALID_ANALYST_ACTIONS: readonly AnalystActionType[] = [
  "raised",
  "lowered",
  "maintained",
  "initiated",
  "other",
];

function isAnalystAction(value: unknown): value is AnalystAction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.firm === "string" &&
    typeof v.action === "string" &&
    (VALID_ANALYST_ACTIONS as readonly string[]).includes(v.action) &&
    (v.priceTarget === null || typeof v.priceTarget === "number") &&
    typeof v.date === "string" &&
    typeof v.source === "string"
  );
}

/**
 * Validates Claude's tool-call output against BriefingContent's shape.
 * Also used to validate cached rows before trusting them as a cache hit
 * -- a row from before this field existed will fail here and be
 * regenerated, rather than silently missing directionalLean downstream.
 */
export function parseBriefingContent(value: unknown): BriefingContent {
  if (typeof value !== "object" || value === null) {
    throw new Error("Briefing response was not an object.");
  }
  const v = value as Record<string, unknown>;

  if (!Array.isArray(v.bullets) || !v.bullets.every(isBullet)) {
    throw new Error("Briefing response had a malformed bullets array.");
  }
  if (v.macro != null && typeof v.macro !== "string") {
    throw new Error("Briefing response had a malformed macro field.");
  }
  if (!isDirectionalLean(v.directionalLean)) {
    throw new Error("Briefing response had a malformed directionalLean field.");
  }
  // Optional, not required: only the per-ticker briefing schema
  // (BRIEFING_INPUT_SCHEMA) asks Claude for this -- lib/todays-summary.ts's
  // market-wide summary reuses this same parser but has no per-ticker
  // firm actions to extract, so an absent field means "not applicable"
  // (empty array), not malformed data. A row missing the field entirely
  // predates Phase 31 for the same reason -- also treated as empty
  // rather than forcing every existing cached briefing to regenerate.
  // If the field IS present, it must still be well-formed.
  if (v.analystActions != null && (!Array.isArray(v.analystActions) || !v.analystActions.every(isAnalystAction))) {
    throw new Error("Briefing response had a malformed analystActions array.");
  }

  return {
    bullets: v.bullets,
    macro: typeof v.macro === "string" && v.macro.trim() ? v.macro : undefined,
    directionalLean: v.directionalLean,
    analystActions: Array.isArray(v.analystActions) ? v.analystActions : [],
  };
}

/** Generates a briefing via the Anthropic API. The only I/O in this module. */
export async function generateBriefing(inputs: BriefingInputs): Promise<BriefingContent> {
  const userPrompt = buildBriefingPrompt(inputs);

  const output = await generateStructuredOutput({
    toolName: BRIEFING_TOOL_NAME,
    toolDescription: "Emits the structured market intelligence briefing.",
    inputSchema: BRIEFING_INPUT_SCHEMA,
    systemPrompt: BRIEFING_SYSTEM_PROMPT,
    userPrompt,
  });

  return parseBriefingContent(output);
}
