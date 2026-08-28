"use client";

import Link from "next/link";
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
  ScreenerResponse,
} from "@/types/api";
import { Section, SkeletonLines, ErrorNote } from "./section";
import { QuoteHeader } from "./quote-header";
import { VolatilityPanel } from "./volatility-panel";
import { MarketReadPanel } from "./market-read-panel";
import { StrikeSelector, type StrikeSelection } from "./strike-selector";
import { StrikeDecisionPanel } from "./strike-decision-panel";
import { ComparisonPanel } from "./comparison-panel";
import { HeadlineList } from "@/components/headline-list";

export function TickerDashboard({ symbol }: { symbol: string }) {
  const quote = useJsonFetch<QuoteResponse>(`/api/quote/${symbol}`);
  const options = useJsonFetch<OptionsResponse>(`/api/options/${symbol}`);
  const earnings = useJsonFetch<EarningsResponse>(`/api/earnings/${symbol}`);
  const news = useJsonFetch<NewsResponse>(`/api/news/${symbol}`);
  const maxPain = useJsonFetch<MaxPainResponse>(`/api/maxpain/${symbol}`);
  const ivHistory = useJsonFetch<IvHistoryResponse>(`/api/iv-history/${symbol}`);
  const putScore = useJsonFetch<EntryScoreResponse>(`/api/entry-score/${symbol}?direction=put`);
  const callScore = useJsonFetch<EntryScoreResponse>(`/api/entry-score/${symbol}?direction=call`);
  // Same relative-strength evaluation the Screener shows for this ticker --
  // reusing its route (not a second computation) is what guarantees the
  // Overview's new line can never disagree with the Screener's.
  const screener = useJsonFetch<ScreenerResponse>(`/api/screener/${symbol}`);

  const [selection, setSelection] = useState<StrikeSelection | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/"
        className="flex w-fit items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        ← Dashboard
      </Link>

      <h1 className="font-mono text-xl font-semibold text-foreground">{symbol}</h1>

      <Section title="Overview">
        {quote.loading && <SkeletonLines count={3} />}
        {quote.error && <ErrorNote message={quote.error} />}
        {quote.data && <QuoteHeader quote={quote.data} screener={screener} />}

        {(options.loading || ivHistory.loading) && <SkeletonLines count={2} />}
        {(options.error || ivHistory.error) && (
          <ErrorNote message={options.error ?? ivHistory.error ?? "Failed to load"} />
        )}
        {options.data && quote.data && ivHistory.data && (
          <VolatilityPanel options={options.data} quote={quote.data} ivHistory={ivHistory.data} />
        )}
      </Section>

      <Section title="Market Read">
        <MarketReadPanel symbol={symbol} earningsState={earnings} />
      </Section>

      <Section title="Strike Selector">
        <div className="flex flex-col gap-5">
          {options.loading && <SkeletonLines count={2} />}
          {options.error && <ErrorNote message={options.error} />}
          {options.data && (
            <StrikeSelector
              symbol={symbol}
              options={options.data}
              underlyingPrice={quote.data?.price ?? options.data.underlyingPrice}
              maxPain={maxPain.data}
              onSelectionChange={setSelection}
            />
          )}

          <StrikeDecisionPanel
            selection={selection}
            currentPrice={quote.data?.price ?? null}
            putScore={putScore}
            callScore={callScore}
          />
        </div>
      </Section>

      {options.data && (
        <ComparisonPanel
          symbol={symbol}
          options={options.data}
          underlyingPrice={quote.data?.price ?? options.data.underlyingPrice}
          putScore={putScore}
          callScore={callScore}
        />
      )}

      <Section title="Further Reading">
        {news.loading && <SkeletonLines count={3} />}
        {news.error && <ErrorNote message={news.error} />}
        {news.data && <HeadlineList headlines={news.data.headlines} />}
      </Section>
    </div>
  );
}
