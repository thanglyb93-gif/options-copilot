"use client";

import { useEffect, useState } from "react";
import type { TodaysSummaryResponse } from "@/types/api";
import { Section } from "@/components/ticker/section";
import { TodaysSummaryPanel } from "./todays-summary-panel";
import { HeadlineLevelSection } from "./headline-groups";

export function NewsDashboard() {
  const [data, setData] = useState<TodaysSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load(forceRefresh: boolean) {
    const setBusy = forceRefresh ? setRefreshing : setLoading;
    setBusy(true);
    setError(null);

    fetch(`/api/todays-summary${forceRefresh ? "?refresh=1" : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error ?? `Request failed (${res.status})`);
          return;
        }
        setData(body as TodaysSummaryResponse);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed"))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const macroHeadlines = (data?.headlines ?? []).filter((h) => h.level === "macro");
  const individualHeadlines = (data?.headlines ?? []).filter((h) => h.level === "individual");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-mono text-xl font-semibold text-foreground">News</h1>

      <Section title="Today's Summary">
        <TodaysSummaryPanel
          data={data}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRefresh={() => load(true)}
        />
      </Section>

      {data && (
        <>
          <HeadlineLevelSection title="Macro & Market-Wide" headlines={macroHeadlines} />
          <HeadlineLevelSection title="Individual Stocks" headlines={individualHeadlines} />
        </>
      )}
    </div>
  );
}
