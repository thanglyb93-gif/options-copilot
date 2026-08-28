"use client";

import type { FetchState } from "@/lib/use-json-fetch";
import { combineWithStrikeCushion } from "@/lib/entry-score";
import { formatOrdinal } from "@/lib/format";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import type {
  EntryScoreResponse,
  IvComponentResult,
  RelativeStrengthComponentResult,
  SkewComponentResult,
} from "@/types/api";
import { SkeletonLines, ErrorNote } from "./section";
import type { StrikeSelection } from "./strike-selector";

function tierClasses(tier: string): { text: string; border: string } {
  if (tier.startsWith("SELL")) return { text: "text-accent", border: "border-accent/40" };
  if (tier === "CONSIDER SKIPPING") return { text: "text-yellow-400", border: "border-yellow-500/40" };
  return { text: "text-red-400", border: "border-red-500/40" };
}

function ComponentRow({
  label,
  detail,
  indicatorId,
}: {
  label: string;
  detail: React.ReactNode;
  indicatorId?: string;
}) {
  const indicator = indicatorId ? guidanceIndicatorById(indicatorId) : undefined;
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-muted">
        {label}
        {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
      </span>
      <span className="font-mono text-foreground">{detail}</span>
    </div>
  );
}

/**
 * IV Percentile and HV Percentile are two permanent, independent
 * indicators -- both always shown when computable, never one standing in
 * for the other. The score attribution below states plainly which one
 * actually produced `score`, so it's never ambiguous.
 */
function IvComponentDetail({ iv }: { iv: IvComponentResult }) {
  const ivText = iv.percentile != null ? `${formatOrdinal(iv.percentile)} pctile` : `${iv.realHistoryCount}/20d`;
  const hvText = iv.hvPercentile != null ? `${formatOrdinal(iv.hvPercentile)} pctile` : "—";

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-foreground">
        {iv.score != null ? iv.score.toFixed(1) : "—"}
        {iv.score != null && (
          <span className="ml-1 text-xs font-normal text-muted">
            (based on {iv.isApproximation ? "HV" : "IV"} Percentile)
          </span>
        )}
      </span>
      <span className="text-xs text-muted">
        IV: {ivText} · HV: {hvText}
      </span>
    </div>
  );
}

function skewDetail(skew: SkewComponentResult): string {
  if (skew.score == null) return skew.note ?? "—";
  const pts = skew.skew ? Math.abs(skew.skew.skew * 100).toFixed(1) : "—";
  const lean = skew.skew?.lean ?? "flat";
  return `${skew.score.toFixed(1)} (${lean}, ${pts}pt)`;
}

function relativeStrengthDetail(rs: RelativeStrengthComponentResult): string {
  if (rs.score == null) return rs.note ?? "—";
  const w = rs.evaluation?.window180;
  const marketPart = w?.vsMarketPct != null ? `${w.vsMarketPct >= 0 ? "+" : ""}${w.vsMarketPct.toFixed(0)}% vs SPY` : null;
  const sectorPart =
    w?.vsSectorPct != null ? `${w.vsSectorPct >= 0 ? "+" : ""}${w.vsSectorPct.toFixed(0)}% vs ${rs.sectorGroupName ?? "sector"}` : null;
  const structure = rs.evaluation?.structuralTrend;
  const structurePart =
    structure === "higher-highs-higher-lows"
      ? "healthy structure"
      : structure === "lower-highs-lower-lows"
        ? "deteriorating structure"
        : "mixed structure";
  const parts = [marketPart, sectorPart, structurePart].filter((p): p is string => p != null);
  return `${rs.score.toFixed(1)} (${parts.join(", ")})`;
}

function technicalDetail(matchedSelection: StrikeSelection | null): string {
  if (!matchedSelection) return "— (select a strike below)";
  const { contract, strike } = matchedSelection;
  if (contract.cushionScore == null) return `— (unavailable for strike ${strike})`;
  const emText =
    contract.emCushion != null ? `${contract.emCushion.toFixed(2)}x expected move` : "expected move unavailable";
  const structural = contract.structuralConfirmation?.confirmed
    ? `, ${matchedSelection.direction === "put" ? "below" : "above"} ${contract.structuralConfirmation.referenceLabel}`
    : "";
  return `${contract.cushionScore.toFixed(1)} (${emText}${structural})`;
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
  selection: StrikeSelection | null;
}) {
  const { data, loading, error } = scoreState;
  const matchedSelection = selection && selection.direction === direction ? selection : null;
  const cushionScoreValue = matchedSelection?.contract.cushionScore ?? null;

  const combined = data ? combineWithStrikeCushion(data.partialTotal, matchedSelection ? cushionScoreValue : null) : null;
  const isComplete = matchedSelection != null && data != null;

  const entryScoreIndicator = guidanceIndicatorById("entry-score");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
        {label}
        {entryScoreIndicator && <ImportanceBadge tier={entryScoreIndicator.importanceTier} />}
      </span>

      {loading && <SkeletonLines count={4} />}
      {error && <ErrorNote message={error} />}

      {data && combined && (
        <>
          {data.eventComponent.opposesTradeDirection && (
            <div className="rounded-md border border-red-500/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300">
              ⚠ Directional signal opposes this trade: {data.eventComponent.rationale}
            </div>
          )}

          {isComplete ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-3xl font-semibold ${tierClasses(combined.tier).text}`}>
                  {combined.total.toFixed(1)}
                </span>
                <span className="text-muted">/ 10</span>
              </div>
              <span
                className={`w-fit rounded border px-2 py-0.5 text-xs font-medium ${tierClasses(combined.tier).text} ${tierClasses(combined.tier).border}`}
              >
                {combined.tier}
              </span>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-semibold text-foreground">
                  {data.partialTotal.toFixed(1)}
                </span>
                <span className="text-muted">/ 8 (partial)</span>
              </div>
              <span className="text-xs text-muted">+ up to 2 more from your selected strike</span>
            </>
          )}

          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <ComponentRow
              label="IV Component"
              detail={<IvComponentDetail iv={data.ivComponent} />}
              indicatorId="iv-percentile"
            />
            <ComponentRow
              label="Technical"
              detail={technicalDetail(matchedSelection)}
              indicatorId="technical-em-cushion"
            />
            <ComponentRow
              label="Events"
              detail={`${(data.eventComponent.catalystScore + data.eventComponent.alignmentScore).toFixed(1)} (catalyst: ${
                data.eventComponent.catalystScore > 0 ? "yes" : "no"
              }, lean: ${data.eventComponent.lean})`}
              indicatorId="events"
            />
            <ComponentRow label="Skew" detail={skewDetail(data.skewComponent)} indicatorId="volatility-skew" />
            <ComponentRow
              label="Relative Strength"
              detail={relativeStrengthDetail(data.relativeStrengthComponent)}
              indicatorId="relative-strength"
            />
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
  selection: StrikeSelection | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <EntryScoreCard label="Put Score" direction="put" scoreState={putScore} selection={selection} />
      <EntryScoreCard label="Call Score" direction="call" scoreState={callScore} selection={selection} />
    </div>
  );
}
