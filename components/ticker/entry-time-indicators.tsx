"use client";

/**
 * Phase 28: the ticker page's entry-time indicators, reorganized into a
 * single vertical, tiered layout -- Core (the Entry Score and its five
 * components), Supporting (informs which contract to fill, no summed
 * score), Context (useful background, not itself thresholded). Replaces
 * the old split across the Overview's Volatility panel and the Strike
 * Selector's "Making Decisions" grid. Position-management indicators
 * (/positions page) are untouched -- this component is entry-time only.
 */

import type { FetchState } from "@/lib/use-json-fetch";
import type { EntryScoreResponse, MaxPainResponse, OptionsResponse, QuoteResponse } from "@/types/api";
import { putCallRatio } from "@/lib/max-pain";
import { describeRsi } from "@/lib/trend";
import { formatPercent } from "@/lib/format";
import { riskProbabilityLabel, parseApproxPercent, ivHvRatioCaution } from "@/lib/indicator-labels";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import { IndicatorLabel, CautionLabel } from "@/components/shared/indicator-label";
import { EntryScorePanel } from "./entry-score-panel";
import type { StrikeSelection } from "./strike-selector";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function BlockHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      <p className="text-xs text-muted">{subtitle}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  indicatorId,
  labelBadge,
  note,
}: {
  label: string;
  value: string;
  indicatorId?: string;
  labelBadge?: React.ReactNode;
  note?: string;
}) {
  const indicator = indicatorId ? guidanceIndicatorById(indicatorId) : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        {label}
        {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
      </span>
      <span className="font-mono text-lg font-semibold text-foreground break-words">{value}</span>
      {labelBadge}
      {note && <span className="text-[10px] leading-tight text-muted">{note}</span>}
    </div>
  );
}

export function EntryTimeIndicators({
  putScore,
  callScore,
  selection,
  options,
  quote,
  maxPain,
}: {
  putScore: FetchState<EntryScoreResponse>;
  callScore: FetchState<EntryScoreResponse>;
  selection: StrikeSelection | null;
  options: OptionsResponse;
  quote: QuoteResponse;
  maxPain: MaxPainResponse | null;
}) {
  const rsiIndicator = guidanceIndicatorById("rsi");

  const assignPct = parseApproxPercent(selection?.contract.assignmentProbability ?? null);
  const touchPct = parseApproxPercent(selection?.contract.probabilityOfTouch ?? null);

  const ratio =
    options.frontMonthAtmIv != null && quote.hv30 != null && quote.hv30 > 0
      ? options.frontMonthAtmIv / quote.hv30
      : null;
  const ratioCaution = ivHvRatioCaution(ratio);

  const pcRatio = maxPain ? putCallRatio(maxPain.strikes) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* CORE ------------------------------------------------------- */}
      <div className="flex flex-col gap-3">
        <BlockHeader
          title="Core"
          subtitle="The Entry Score and its five components -- directly drives the SELL/DON'T SELL recommendation."
        />
        <EntryScorePanel putScore={putScore} callScore={callScore} selection={selection} />
      </div>

      {/* SUPPORTING --------------------------------------------------- */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <BlockHeader
          title="Supporting"
          subtitle="Informs which specific contract to fill -- not summed into the Entry Score."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Assignment Probability"
            indicatorId="assignment-probability"
            value={selection?.contract.assignmentProbability ?? "—"}
            labelBadge={assignPct != null ? <IndicatorLabel text={riskProbabilityLabel(assignPct)} /> : undefined}
          />
          <StatCard
            label="Probability of Touch"
            indicatorId="probability-of-touch"
            value={selection?.contract.probabilityOfTouch ?? "—"}
            labelBadge={touchPct != null ? <IndicatorLabel text={riskProbabilityLabel(touchPct)} /> : undefined}
          />
          <StatCard
            label="Liquidity / Spread"
            indicatorId="liquidity-spread-score"
            value={selection?.contract.spreadPct != null ? `${selection.contract.spreadPct.toFixed(1)}%` : "—"}
            labelBadge={
              selection?.contract.spreadLabel ? <IndicatorLabel text={capitalize(selection.contract.spreadLabel)} /> : undefined
            }
          />
          <StatCard
            label="IV Term Structure"
            indicatorId="iv-term-structure"
            value={options.termStructure ? `${options.termStructure.relativeDifferencePct.toFixed(1)}%` : "—"}
            labelBadge={
              options.termStructure ? <IndicatorLabel text={capitalize(options.termStructure.classification)} /> : undefined
            }
          />
        </div>
        {!selection && (
          <p className="text-xs text-muted">
            Select a strike above to see Assignment Probability, Probability of Touch, and Liquidity/Spread for that contract.
          </p>
        )}
      </div>

      {/* CONTEXT -------------------------------------------------------- */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <BlockHeader title="Context" subtitle="Useful background to read alongside the above -- not itself a scored input." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Front-Month ATM IV"
            value={formatPercent(options.frontMonthAtmIv != null ? options.frontMonthAtmIv * 100 : null, 1)}
            note="Feeds IV Percentile & IV Term Structure (Core / Supporting, above)"
          />
          <StatCard
            label="30d HV"
            value={formatPercent(quote.hv30 != null ? quote.hv30 * 100 : null, 1)}
            note="Feeds HV Percentile (Core, above) & the IV/HV ratio here"
          />
          <StatCard
            label="IV / HV Ratio"
            value={ratio != null ? ratio.toFixed(2) : "—"}
            labelBadge={ratioCaution ? <CautionLabel text={ratioCaution} /> : undefined}
          />
          <StatCard
            label="Open Interest"
            indicatorId="open-interest"
            value={selection?.contract.openInterest != null ? selection.contract.openInterest.toLocaleString() : "—"}
          />
          <StatCard
            label="Max Pain"
            indicatorId="max-pain"
            value={maxPain?.maxPainStrike != null ? String(maxPain.maxPainStrike) : "—"}
          />
          <StatCard
            label="Put/Call Ratio"
            indicatorId="put-call-ratio"
            value={pcRatio != null ? pcRatio.toFixed(2) : "—"}
          />
        </div>
        {quote.rsi != null && (
          <p className="flex items-center gap-2 text-sm text-foreground">
            {describeRsi(quote.rsi)}
            {rsiIndicator && <ImportanceBadge tier={rsiIndicator.importanceTier} />}
          </p>
        )}
      </div>
    </div>
  );
}
