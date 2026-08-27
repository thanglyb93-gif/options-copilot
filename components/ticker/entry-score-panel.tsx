"use client";

import type { FetchState } from "@/lib/use-json-fetch";
import { tierForTotal } from "@/lib/entry-score";
import type { EntryScoreResponse } from "@/types/api";
import { SkeletonLines, ErrorNote } from "./section";
import type { ChainSelection } from "./options-chain";

function ordinal(n: number): string {
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

function tierClasses(tier: string): { text: string; border: string } {
  if (tier.startsWith("SELL")) return { text: "text-accent", border: "border-accent/40" };
  if (tier === "CONSIDER SKIPPING") return { text: "text-yellow-400", border: "border-yellow-500/40" };
  return { text: "text-red-400", border: "border-red-500/40" };
}

function ComponentRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{detail}</span>
    </div>
  );
}

function EntryScoreCard({
  label,
  direction,
  scoreState,
  selection,
}: {
  label: string;
  direction: "put" | "call";
  scoreState: FetchState<EntryScoreResponse>;
  selection: ChainSelection | null;
}) {
  const { data, loading, error } = scoreState;
  const matchedSelection = selection && selection.direction === direction ? selection : null;
  const cushionScoreValue = matchedSelection?.contract.cushionScore ?? null;

  const total = data
    ? matchedSelection
      ? data.partialTotal + (cushionScoreValue ?? 0)
      : data.partialTotal
    : null;
  const isComplete = matchedSelection != null && data != null;
  const tier = isComplete && total != null ? tierForTotal(total) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>

      {loading && <SkeletonLines count={4} />}
      {error && <ErrorNote message={error} />}

      {data && (
        <>
          {data.eventComponent.opposesTradeDirection && (
            <div className="rounded-md border border-red-500/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300">
              ⚠ Directional signal opposes this trade: {data.eventComponent.rationale}
            </div>
          )}

          {tier ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-3xl font-semibold ${tierClasses(tier).text}`}>
                  {total!.toFixed(1)}
                </span>
                <span className="text-muted">/ 6</span>
              </div>
              <span
                className={`w-fit rounded border px-2 py-0.5 text-xs font-medium ${tierClasses(tier).text} ${tierClasses(tier).border}`}
              >
                {tier}
              </span>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-semibold text-foreground">
                  {data.partialTotal.toFixed(1)}
                </span>
                <span className="text-muted">/ 4 (partial)</span>
              </div>
              <span className="text-xs text-muted">+ up to 2 more from your selected strike</span>
            </>
          )}

          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <ComponentRow
              label="IV Percentile"
              detail={
                data.ivComponent.score != null
                  ? `${data.ivComponent.score.toFixed(1)} (${ordinal(data.ivComponent.percentile ?? 0)} percentile)`
                  : `— (${data.ivComponent.note ?? "unavailable"})`
              }
            />
            <ComponentRow
              label="Events"
              detail={`${(data.eventComponent.catalystScore + data.eventComponent.alignmentScore).toFixed(1)} (catalyst: ${
                data.eventComponent.catalystScore > 0 ? "yes" : "no"
              }, lean: ${data.eventComponent.lean})`}
            />
            {matchedSelection && (
              <ComponentRow
                label="Strike Cushion"
                detail={
                  cushionScoreValue != null
                    ? `${cushionScoreValue.toFixed(1)} (strike ${matchedSelection.strike})`
                    : `— (unavailable for strike ${matchedSelection.strike})`
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function EntryScorePanel({
  putScore,
  callScore,
  selection,
}: {
  putScore: FetchState<EntryScoreResponse>;
  callScore: FetchState<EntryScoreResponse>;
  selection: ChainSelection | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <EntryScoreCard label="Put Score" direction="put" scoreState={putScore} selection={selection} />
      <EntryScoreCard label="Call Score" direction="call" scoreState={callScore} selection={selection} />
    </div>
  );
}
