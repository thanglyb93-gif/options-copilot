"use client";

import { useEffect, useState } from "react";
import type { MarketPulseResponse } from "@/types/api";
import { Section, SkeletonLines, ErrorNote } from "@/components/ticker/section";
import { HeadlineList } from "@/components/headline-list";
import { MarketPulsePanel } from "./market-pulse-panel";

export function NewsDashboard() {
  const [data, setData] = useState<MarketPulseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load(forceRefresh: boolean) {
    const setBusy = forceRefresh ? setRefreshing : setLoading;
    setBusy(true);
    setError(null);

    fetch(`/api/market-pulse${forceRefresh ? "?refresh=1" : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error ?? `Request failed (${res.status})`);
          return;
        }
        setData(body as MarketPulseResponse);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed"))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-mono text-xl font-semibold text-foreground">News</h1>

      <Section title="Market Pulse">
        <MarketPulsePanel
          data={data}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRefresh={() => load(true)}
        />
      </Section>

      <Section title="Headlines">
        {loading && <SkeletonLines count={5} />}
        {error && <ErrorNote message={error} />}
        {data && <HeadlineList headlines={data.headlines} />}
      </Section>
    </div>
  );
}
