/**
 * Builds the prompt for the daily "Today's Summary" briefing and
 * validates Claude's structured response. Replaces the old Market Pulse:
 * same architectural role as lib/briefing.ts (pure prompt/schema/
 * validation, generateTodaysSummary is the only I/O), but now scoped to
 * both macro and individual-company headlines (split by
 * lib/headline-classification.ts) and explicitly watchlist-aware --
 * given the user's current watchlist tickers as context and instructed
 * to call out anything specifically relevant to them. Reuses
 * lib/briefing.ts's content shape (bullets + directionalLean) since it's
 * structurally identical.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { generateStructuredOutput } from "./anthropic";
import {
  formatHeadlines,
  parseBriefingContent,
  type BriefingContent,
  type BriefingHeadline,
} from "./briefing";

export interface TodaysSummaryInputs {
  asOf: string; // ISO date
  watchlistTickers: string[];
  macroHeadlines: BriefingHeadline[];
  individualHeadlines: BriefingHeadline[];
}

export const TODAYS_SUMMARY_SYSTEM_PROMPT = `You are a market intelligence analyst producing a condensed daily summary for an options trader who evaluates covered calls and cash-secured puts across many individual stocks, including a specific personal watchlist. Your only job is to summarize what the provided headlines actually say and note their likely relevance to market-wide risk and to the trader's watchlist specifically.

Strict rules:
- Only state what the provided headlines actually say. Do not speculate, infer motives, or add information not present in the sources.
- If two sources conflict, say so explicitly in the relevant bullet rather than picking one.
- Every bullet's "impact" must describe a concrete likely effect -- on broad market risk/volatility/sentiment, or on a specific watchlist ticker -- never generic filler like "this could be important" or "investors should watch this."
- The trader's current watchlist is given below. If ANY of today's macro or individual-company headlines are specifically relevant to one of those tickers (e.g. sector-wide regulatory action, a named watchlist company in the individual headlines, a macro shift that plausibly moves that ticker's sector), you must surface that connection explicitly and name the ticker -- don't bury it in generic market commentary. If genuinely nothing in today's headlines connects to the watchlist, don't force a connection -- say so is not required, just omit forced ticker mentions.
- Produce 3 to 5 bullets total, drawing from both macro and individual-company headlines as warranted by what's actually decision-relevant today. Prioritize the most decision-relevant, recent items over older or minor ones.

You must also synthesize an overall read on market risk tone for the coming days, based solely on the weight of evidence in the gathered headlines:
- "bullish" if the evidence points toward broad risk-on strength
- "bearish" if it points toward broad risk-off weakness
- "mixed" if the evidence genuinely conflicts (some signals risk-on, some risk-off, no clear majority)
- "neutral" if there is no clear signal either way, or the available headlines are too thin to support a view
Give a one-to-two sentence rationale grounded in the same headlines as your bullets, mentioning the watchlist connection if one was surfaced in your bullets. Do not force a bullish or bearish call when the evidence is thin or conflicting -- "neutral" or "mixed" with an honest rationale is the correct answer in that case, not a guess.`;

/** Builds the user-message prompt from structured inputs. Pure, no I/O. */
export function buildTodaysSummaryPrompt(inputs: TodaysSummaryInputs): string {
  const watchlistLine =
    inputs.watchlistTickers.length > 0
      ? inputs.watchlistTickers.join(", ")
      : "(empty -- no tickers currently on the watchlist)";

  return `Today's date: ${inputs.asOf.slice(0, 10)}

Trader's current watchlist: ${watchlistLine}

Macro / market-wide headlines (most recent first):
${formatHeadlines(inputs.macroHeadlines)}

Individual-company headlines (most recent first):
${formatHeadlines(inputs.individualHeadlines)}

Produce today's summary now, following the rules in your system prompt.`;
}

export const TODAYS_SUMMARY_TOOL_NAME = "emit_todays_summary";

const TODAYS_SUMMARY_INPUT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    bullets: {
      type: "array",
      minItems: 3,
      maxItems: 5,
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
              "One sentence on the likely effect on broad market risk/volatility/sentiment, or on a named watchlist ticker.",
          },
        },
        required: ["fact", "source", "impact"],
      },
    },
    directionalLean: {
      type: "object",
      properties: {
        lean: {
          type: "string",
          enum: ["bullish", "neutral", "bearish", "mixed"],
          description: "The weight-of-evidence read on overall market risk tone for the coming days.",
        },
        rationale: {
          type: "string",
          description: "One to two sentences grounding the read in the headlines above.",
        },
      },
      required: ["lean", "rationale"],
    },
  },
  required: ["bullets", "directionalLean"],
};

/** Generates Today's Summary via the Anthropic API. The only I/O in this module. */
export async function generateTodaysSummary(inputs: TodaysSummaryInputs): Promise<BriefingContent> {
  const userPrompt = buildTodaysSummaryPrompt(inputs);

  const output = await generateStructuredOutput({
    toolName: TODAYS_SUMMARY_TOOL_NAME,
    toolDescription: "Emits the structured daily summary.",
    inputSchema: TODAYS_SUMMARY_INPUT_SCHEMA,
    systemPrompt: TODAYS_SUMMARY_SYSTEM_PROMPT,
    userPrompt,
  });

  return parseBriefingContent(output);
}
