/**
 * Composes the Market Pulse panel's paragraph from already-fetched
 * content. Pure formatting, no I/O -- mirrors lib/market-read.ts's role
 * for the per-ticker Market Read section, minus the earnings sentence
 * (there's no single ticker's earnings date to fold in here).
 */

import type { BriefingContent, DirectionalLean } from "@/types/api";

export interface MarketPulseComposition {
  /** Fact-plus-source sentences. */
  sentences: string[];
  /** The conclusion sentence's content, without the "Net read:" prefix. */
  netRead: string;
}

const LEAN_PHRASE: Record<DirectionalLean, string> = {
  bullish: "the evidence points toward broad risk-on strength",
  bearish: "the evidence points toward broad risk-off weakness",
  mixed: "the evidence is mixed",
  neutral: "there's no clear directional signal",
};

function factSentence(fact: string, source: string): string {
  const trimmed = fact.trim().replace(/\.+$/, "");
  return `${trimmed} (${source}).`;
}

export function composeMarketPulse(content: BriefingContent): MarketPulseComposition {
  const sentences = content.bullets.slice(0, 5).map((b) => factSentence(b.fact, b.source));
  const netRead = `${LEAN_PHRASE[content.directionalLean.lean]} — ${content.directionalLean.rationale}`;

  return { sentences, netRead };
}
