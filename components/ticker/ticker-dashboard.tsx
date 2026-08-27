"use client";

import { useState } from "react";
import { useJsonFetch } from "@/lib/use-json-fetch";
import type {
  EarningsResponse,
  EntryScoreResponse,
  IvHistoryResponse,
  MaxPainResponse,
  NewsResponse,
  OptionsResponse,
  QuoteResponse,
} from "@/types/api";
import { Section, SkeletonLines, ErrorNote } from "./section";
import { QuoteHeader } from "./quote-header";
import { VolatilityPanel } from "./volatility-panel";
import { EarningsPanel } from "./earnings-panel";
import { OptionsChain, type ChainSelection } from "./options-chain";
import { StrikeDecisionPanel } from "./strike-decision-panel";
import { BriefingPanel } from "./briefing-panel";
import { EntryScorePanel } from "./entry-score-panel";

export function TickerDashboard({ symbol }: { symbol: string }) {
  const quote = useJsonFetch<QuoteResponse>(`/api/quote/${symbol}`);
  const options = useJsonFetch<OptionsResponse>(`/api/options/${symbol}`);
  const earnings = useJsonFetch<EarningsResponse>(`/api/earnings/${symbol}`);
  const news = useJsonFetch<NewsResponse>(`/api/news/${symbol}`);
  const maxPain = useJsonFetch<MaxPainResponse>(`/api/maxpain/${symbol}`);
  const ivHistory = useJsonFetch<IvHistoryResponse>(`/api/iv-history/${symbol}`);
  const putScore = useJsonFetch<EntryScoreResponse>(`/api/entry-score/${symbol}?direction=put`);
  const callScore = useJsonFetch<EntryScoreResponse>(`/api/entry-score/${symbol}?direction=call`);

  const [selection, setSelection] = useState<ChainSelection | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-mono text-xl font-semibold text-foreground">{symbol}</h1>

      <Section title="Overview">
        {quote.loading && <SkeletonLines count={3} />}
        {quote.error && <ErrorNote message={quote.error} />}
        {quote.data && <QuoteHeader quote={quote.data} />}
      </Section>

      <Section title="Entry Score">
        <EntryScorePanel putScore={putScore} callScore={callScore} selection={selection} />
      </Section>

      <Section title="Volatility">
        {(options.loading || quote.loading || ivHistory.loading) && <SkeletonLines count={2} />}
        {(options.error || quote.error || ivHistory.error) && (
          <ErrorNote message={options.error ?? quote.error ?? ivHistory.error ?? "Failed to load"} />
        )}
        {options.data && quote.data && ivHistory.data && (
          <VolatilityPanel options={options.data} quote={quote.data} ivHistory={ivHistory.data} />
        )}
      </Section>

      <Section title="Earnings & Catalysts">
        {earnings.loading && <SkeletonLines count={3} />}
        {earnings.error && <ErrorNote message={earnings.error} />}
        {earnings.data && <EarningsPanel earnings={earnings.data} news={news.data} />}
      </Section>

      <Section title="Briefing">
        <BriefingPanel symbol={symbol} />
      </Section>

      <Section title="Options Chain">
        {options.loading && <SkeletonLines count={5} />}
        {options.error && <ErrorNote message={options.error} />}
        {options.data && (
          <OptionsChain
            options={options.data}
            maxPain={maxPain.data}
            onSelectContract={setSelection}
          />
        )}
      </Section>

      <Section title="Strike Decision Panel">
        <StrikeDecisionPanel
          selection={selection}
          currentPrice={quote.data?.price ?? null}
          putScore={putScore.data}
          callScore={callScore.data}
        />
      </Section>
    </div>
  );
}
