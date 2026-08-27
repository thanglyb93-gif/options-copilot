/**
 * Composes the Market Read section's paragraph from already-fetched
 * briefing + earnings data. No I/O and no Anthropic call here -- this is
 * pure formatting over data the briefing/earnings routes already produced.
 */

import type { BriefingContent, DirectionalLean } from "./briefing";
import type { EarningsResponse } from "@/types/api";
import { formatDate } from "./format";

export interface MarketReadComposition {
  /** Fact-plus-source sentences, followed by an earnings sentence. */
  sentences: string[];
  /** The conclusion sentence's content, without the "Net read:" prefix. */
  netRead: string;
  cooldownFlagged: boolean;
  cooldownPercentMove: number | null;
}

const LEAN_PHRASE: Record<DirectionalLean, string> = {
  bullish: "the evidence points bullish",
  bearish: "the evidence points bearish",
  mixed: "the evidence is mixed",
  neutral: "there's no clear directional signal",
};

function factSentence(fact: string, source: string): string {
  const trimmed = fact.trim().replace(/\.+$/, "");
  return `${trimmed} (${source}).`;
}

function earningsSentence(earnings: EarningsResponse): string {
  const { nextEarningsDate, daysUntilEarnings, earningsCooldown } = earnings;

  if (!nextEarningsDate || daysUntilEarnings == null) {
    return "No confirmed upcoming earnings date.";
  }

  const dateLabel = formatDate(nextEarningsDate);
  const base = `Next earnings are ${dateLabel} (${daysUntilEarnings}d away)`;

  if (earningsCooldown.flagged && earningsCooldown.percentMoveLast10TradingDays != null) {
    const pct = earningsCooldown.percentMoveLast10TradingDays;
    return `${base}; the stock has already moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% over the last 10 trading days, so the earnings-cooldown flag is active.`;
  }

  return `${base}.`;
}

/** Caps the paragraph at 3-5 fact sentences plus one earnings sentence. */
export function composeMarketRead(
  briefing: BriefingContent,
  earnings: EarningsResponse
): MarketReadComposition {
  const factSentences = briefing.bullets
    .slice(0, 5)
    .map((b) => factSentence(b.fact, b.source));

  const sentences = [...factSentences, earningsSentence(earnings)];

  const netRead = `${LEAN_PHRASE[briefing.directionalLean.lean]} — ${briefing.directionalLean.rationale}`;

  return {
    sentences,
    netRead,
    cooldownFlagged: earnings.earningsCooldown.flagged,
    cooldownPercentMove: earnings.earningsCooldown.percentMoveLast10TradingDays,
  };
}
