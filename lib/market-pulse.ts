/**
 * Builds the prompt for the daily market-wide "Market Pulse" briefing and
 * validates Claude's structured response. Same architectural role as
 * lib/briefing.ts (pure prompt/schema/validation, generateMarketPulse is
 * the only I/O), scoped to general-market headlines instead of one
 * ticker. Reuses briefing.ts's content shape (bullets + directionalLean)
 * since it's structurally identical -- a Market Pulse is a briefing whose
 * subject is the market as a whole rather than a single stock.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { generateStructuredOutput } from "./anthropic";
import {
  formatHeadlines,
  parseBriefingContent,
  type BriefingContent,
  type BriefingHeadline,
} from "./briefing";

export interface MarketPulseInputs {
  asOf: string; // ISO date
  headlines: BriefingHeadline[];
}

export const MARKET_PULSE_SYSTEM_PROMPT = `You are a market intelligence analyst producing a condensed daily briefing on what is moving markets broadly today, for an options trader who evaluates covered calls and cash-secured puts across many individual stocks. Your only job is to summarize what the provided general-market headlines actually say and note their likely relevance to market-wide risk and volatility.

Strict rules:
- Only state what the provided headlines actually say. Do not speculate, infer motives, or add information not present in the sources.
- If two sources conflict, say so explicitly in the relevant bullet rather than picking one.
- Every bullet's "impact" must describe the likely effect on broad market risk, volatility, or sentiment -- never generic filler like "this could be important" or "investors should watch this."
- Cover the breadth of what's actually moving markets when present in the headlines: Fed/rate commentary, jobs and economic data, major M&A, significant geopolitical developments, and notable S&P 500 earnings. Only report on the categories genuinely present and decision-relevant in the headlines given -- do not force coverage of a category with nothing recent.
- Produce 3 to 6 bullets. Prioritize the most decision-relevant, recent items over older or minor ones.

You must also synthesize an overall read on market risk tone for the coming days, based solely on the weight of evidence in the gathered headlines:
- "bullish" if the evidence points toward broad risk-on strength
- "bearish" if it points toward broad risk-off weakness
- "mixed" if the evidence genuinely conflicts (some signals risk-on, some risk-off, no clear majority)
- "neutral" if there is no clear signal either way, or the available headlines are too thin to support a view
Give a one-to-two sentence rationale grounded in the same headlines as your bullets. Do not force a bullish or bearish call when the evidence is thin or conflicting -- "neutral" or "mixed" with an honest rationale is the correct answer in that case, not a guess.`;

/** Builds the user-message prompt from structured inputs. Pure, no I/O. */
export function buildMarketPulsePrompt(inputs: MarketPulseInputs): string {
  return `Today's date: ${inputs.asOf.slice(0, 10)}

General market headlines (most recent first):
${formatHeadlines(inputs.headlines)}

Produce the market pulse now, following the rules in your system prompt.`;
}

export const MARKET_PULSE_TOOL_NAME = "emit_market_pulse";

const MARKET_PULSE_INPUT_SCHEMA: Anthropic.Tool.InputSchema = {
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
            description: "One sentence on the likely effect on broad market risk, volatility, or sentiment.",
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

/** Generates the Market Pulse via the Anthropic API. The only I/O in this module. */
export async function generateMarketPulse(inputs: MarketPulseInputs): Promise<BriefingContent> {
  const userPrompt = buildMarketPulsePrompt(inputs);

  const output = await generateStructuredOutput({
    toolName: MARKET_PULSE_TOOL_NAME,
    toolDescription: "Emits the structured daily market pulse.",
    inputSchema: MARKET_PULSE_INPUT_SCHEMA,
    systemPrompt: MARKET_PULSE_SYSTEM_PROMPT,
    userPrompt,
  });

  return parseBriefingContent(output);
}
