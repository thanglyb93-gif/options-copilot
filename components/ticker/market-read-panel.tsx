"use client";

import type { BriefingResponse } from "@/types/api";
import type { FetchState } from "@/lib/use-json-fetch";
import type { BriefingFetchState } from "@/lib/use-briefing";
import type { EarningsResponse } from "@/types/api";
import { formatRelativeTime } from "@/lib/format";
import { composeMarketRead } from "@/lib/market-read";
import { EVENTS_CATALYST_MAX } from "@/lib/entry-score";
import { SkeletonLines, ErrorNote } from "./section";

/**
 * Phase 43 Part C -- shown in place of the AI-generated prose when
 * generation was capped or genuinely failed. Every value here already
 * existed before this request (no new Anthropic call): catalyst
 * recency is the same mechanical Events sub-score, and the lean (when
 * present at all) is whatever a prior real generation left behind,
 * however old -- its own age always stated so the staleness is
 * explicit, never implied to be current.
 */
function StructuredFactsFallback({ data }: { data: BriefingResponse }) {
  const fallback = data.fallback;
  if (!fallback) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {data.mode === "capped"
          ? `Daily AI summary limit reached (${data.dailyStatus.count}/${data.dailyStatus.cap}) — showing what's already known instead of generating a new one.`
          : "AI summary temporarily unable to generate — showing what's already known instead."}
      </p>
      <ul className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
        <li className="flex items-baseline justify-between gap-2">
          <span className="text-muted">Catalyst recency</span>
          <span className="font-mono text-foreground">
            {fallback.catalystRecencyScore.toFixed(1)} / {EVENTS_CATALYST_MAX.toFixed(1)}
          </span>
        </li>
        {fallback.cachedLean ? (
          <li className="flex flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-muted">Last known directional lean</span>
              <span className="text-[11px] text-muted">
                {formatRelativeTime(fallback.cachedLean.generatedAt)}
              </span>
            </span>
            <span className="text-foreground">
              <span className="font-semibold capitalize">{fallback.cachedLean.lean}</span> —{" "}
              {fallback.cachedLean.rationale}
            </span>
          </li>
        ) : (
          <li className="text-muted">No directional lean has ever been generated for this ticker yet.</li>
        )}
        <li className="text-muted">See Further Reading below for raw sourced headlines.</li>
      </ul>
    </div>
  );
}

export function MarketReadPanel({
  briefing,
  earningsState,
}: {
  /** Lifted to the ticker page (lib/use-briefing.ts) and shared with quote-header.tsx's Recent Analyst Actions -- see that hook's doc comment for why this can't be its own independent fetch anymore. */
  briefing: BriefingFetchState;
  earningsState: FetchState<EarningsResponse>;
}) {
  const { data, loading, error, refreshing, refresh } = briefing;

  const composed =
    data?.content && earningsState.data ? composeMarketRead(data.content, earningsState.data) : null;

  const stillLoading = loading || earningsState.loading;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          {data?.generatedAt && (
            <span className="text-xs text-muted">Updated {formatRelativeTime(data.generatedAt)}</span>
          )}
          {data && (
            <span className="text-[11px] text-muted">
              Market Read generations today: {data.dailyStatus.count}/{data.dailyStatus.cap}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing || loading}
          className="ml-auto min-h-11 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50 lg:min-h-0"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {stillLoading && <SkeletonLines count={4} />}
      {error && (
        <p className="text-sm text-muted">
          Market Read unavailable (AI summary temporarily unable to generate) — see Further
          Reading below for raw sourced headlines.
        </p>
      )}
      {earningsState.error && <ErrorNote message={earningsState.error} />}

      {data?.fallback && <StructuredFactsFallback data={data} />}

      {composed && data?.content && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            {composed.cooldownFlagged && (
              <span
                className="mt-0.5 shrink-0 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-300"
                title="Price has moved sharply over the last 10 trading days"
              >
                ⚠ cooldown
              </span>
            )}
            <p className="text-sm leading-relaxed text-foreground">
              {composed.sentences.join(" ")}
            </p>
          </div>

          <p className="border-t border-border pt-3 text-sm font-semibold leading-relaxed text-foreground">
            <span className="text-accent">Net read:</span> {composed.netRead}
          </p>

          {data.content.macro && (
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                Macro backdrop
              </span>
              <p className="mt-1 text-sm text-foreground">{data.content.macro}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
