"use client";

import type { FetchState } from "@/lib/use-json-fetch";
import {
  combineWithStrikeCushion,
  EVENTS_ALIGNMENT_MAX,
  EVENTS_CATALYST_MAX,
  EVENTS_WEIGHT,
  IV_WEIGHT,
  RELATIVE_STRENGTH_WEIGHT,
  round1,
  SKEW_WEIGHT,
  TECHNICAL_SCALE,
  TECHNICAL_WEIGHT,
} from "@/lib/entry-score";
import { formatOrdinal } from "@/lib/format";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { cushionLabel, percentileLabel, skewLeanLabel } from "@/lib/indicator-labels";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import { IndicatorLabel } from "@/components/shared/indicator-label";
import { TimingCautionIcon } from "@/components/shared/timing-caution-badge";
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
  footnote,
}: {
  label: string;
  detail: React.ReactNode;
  indicatorId?: string;
  /** A full-width sentence below the label/detail row -- e.g. Phase 34's momentum-adjustment disclosure. Never used to hide a score change silently. */
  footnote?: React.ReactNode;
}) {
  const indicator = indicatorId ? guidanceIndicatorById(indicatorId) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted">
          {label}
          {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
        </span>
        <span className="font-mono text-foreground">{detail}</span>
      </div>
      {footnote}
    </div>
  );
}

/**
 * Phase 34 -- transparency disclosure for the momentum-adjusted cushion
 * buffer (lib/expected-move.ts's momentumBufferMultiplier): whenever it's
 * actually active for the selected call, this states the multiplier and
 * the exact underlying/sector evidence driving it, in plain sight next
 * to the score it affects. Never a silent penalty.
 */
function MomentumAdjustmentNote({ matchedSelection }: { matchedSelection: StrikeSelection | null }) {
  const adjustment = matchedSelection?.contract.momentumAdjustment;
  if (!adjustment) return null;
  return (
    <p className="text-[11px] leading-relaxed text-amber-300">
      ⚠ Momentum-adjusted cushion required ({adjustment.multiplier.toFixed(1)}x): {adjustment.reason}
    </p>
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
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-foreground">
        {iv.score != null ? `${iv.score.toFixed(1)} / ${IV_WEIGHT.toFixed(1)}` : "—"}
        {iv.score != null && (
          <span className="ml-1 text-xs font-normal text-muted">
            (based on {iv.isApproximation ? "HV" : "IV"} Percentile)
          </span>
        )}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted">
        <span className="flex items-center gap-1">
          IV: {ivText}
          {iv.percentile != null && <IndicatorLabel text={percentileLabel(iv.percentile)} />}
        </span>
        <span className="flex items-center gap-1">
          HV: {hvText}
          {iv.hvPercentile != null && <IndicatorLabel text={percentileLabel(iv.hvPercentile)} />}
        </span>
      </div>
    </div>
  );
}

function SkewDetail({ skew }: { skew: SkewComponentResult }) {
  if (skew.score == null) return <>{skew.note ?? "—"}</>;
  const pts = skew.skew ? Math.abs(skew.skew.skew * 100).toFixed(1) : "—";
  const lean = skew.skew?.lean ?? "flat";
  return (
    <span className="flex items-center justify-end gap-1.5">
      {skew.score.toFixed(1)} / {SKEW_WEIGHT.toFixed(1)} ({pts}pt)
      <IndicatorLabel text={skewLeanLabel(lean)} />
    </span>
  );
}

/**
 * Phase 40 -- Events' two continuous sub-scores (catalyst recency,
 * mechanical; directional alignment, the LLM-derived lean) shown
 * separately rather than only as their sum, so the breakdown driving
 * the total is never hidden.
 */
function EventsDetail({ events }: { events: EntryScoreResponse["eventComponent"] }) {
  const total = round1(events.catalystScore + events.alignmentScore);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-foreground">
        {total.toFixed(1)} / {EVENTS_WEIGHT.toFixed(1)}
      </span>
      <span className="text-xs text-muted">
        catalyst recency {events.catalystScore.toFixed(1)}/{EVENTS_CATALYST_MAX.toFixed(1)}, directional alignment{" "}
        {events.alignmentScore.toFixed(1)}/{EVENTS_ALIGNMENT_MAX.toFixed(1)} (lean: {events.lean})
      </span>
    </div>
  );
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
  return `${rs.score.toFixed(1)} / ${RELATIVE_STRENGTH_WEIGHT.toFixed(1)} (${parts.join(", ")})`;
}

function TechnicalDetail({ matchedSelection }: { matchedSelection: StrikeSelection | null }) {
  if (!matchedSelection) return <>— (select a strike below)</>;
  const { contract, strike } = matchedSelection;
  if (contract.cushionScore == null) return <>— (unavailable for strike {strike})</>;
  const emText =
    contract.emCushion != null ? `${contract.emCushion.toFixed(2)}x expected move` : "expected move unavailable";
  const structural = contract.structuralConfirmation?.confirmed
    ? `, ${matchedSelection.direction === "put" ? "below" : "above"} ${contract.structuralConfirmation.referenceLabel}`
    : "";
  // contract.cushionScore is lib/expected-move.ts's raw 0-2 cushionScore
  // (shared with Roll Calculator/Simulated Backtest/Counterfactual
  // Backtest at that same scale) -- weighted to the Entry Score's own
  // Technical/EM Cushion range (2.5) only here, at display time,
  // identically to how combineWithStrikeCushion weights it for the total.
  const weighted = Math.round(contract.cushionScore * TECHNICAL_SCALE * 10) / 10;
  return (
    <span className="flex items-center justify-end gap-1.5">
      {weighted.toFixed(1)} / {TECHNICAL_WEIGHT.toFixed(1)} ({emText}
      {structural})
      {contract.emCushion != null && <IndicatorLabel text={cushionLabel(contract.emCushion)} />}
    </span>
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
                <TimingCautionIcon timingCaution={data.timingCaution} />
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
                <TimingCautionIcon timingCaution={data.timingCaution} />
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
              detail={<TechnicalDetail matchedSelection={matchedSelection} />}
              indicatorId="technical-em-cushion"
              footnote={<MomentumAdjustmentNote matchedSelection={matchedSelection} />}
            />
            <ComponentRow
              label="Events"
              detail={<EventsDetail events={data.eventComponent} />}
              indicatorId="events"
            />
            <ComponentRow label="Skew" detail={<SkewDetail skew={data.skewComponent} />} indicatorId="volatility-skew" />
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <EntryScoreCard label="Put Score" direction="put" scoreState={putScore} selection={selection} />
      <EntryScoreCard label="Call Score" direction="call" scoreState={callScore} selection={selection} />
    </div>
  );
}
