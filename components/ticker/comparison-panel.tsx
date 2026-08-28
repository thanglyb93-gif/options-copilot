"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComparisonResponse, ComparisonSideResult, EntryScoreResponse, OptionsResponse } from "@/types/api";
import { useJsonFetch, type FetchState } from "@/lib/use-json-fetch";
import { combineWithStrikeCushion } from "@/lib/entry-score";
import { formatCurrency, formatMonthDay, formatPercent } from "@/lib/format";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import { Section, SkeletonLines, ErrorNote, SubsectionHeader } from "./section";

// ---------------------------------------------------------------------------
// Independent DTE/Strike mini-selector -- one instance per side, deliberately
// not synced to each other (different DTE/delta per side is the whole point
// of this comparison). Mirrors strike-selector.tsx's own default-picking
// behavior (closest-to-price strike, re-picked when the strike list changes
// out from under the current selection) but is its own small copy scoped to
// this panel -- not a shared hook, since strike-selector.tsx's version is
// bound up with that component's cost-basis/direction state.
// ---------------------------------------------------------------------------

function useMiniStrikeSelector(options: OptionsResponse, underlyingPrice: number | null) {
  const [expirationIndex, setExpirationIndex] = useState(options.defaultExpirationIndex);
  const [strike, setStrike] = useState<number | null>(null);
  const expiration = options.expirations[expirationIndex];

  const strikes = useMemo(() => {
    if (!expiration) return [];
    const set = new Set<number>();
    expiration.calls.forEach((c) => set.add(c.strike));
    expiration.puts.forEach((p) => set.add(p.strike));
    return Array.from(set).sort((a, b) => a - b);
  }, [expiration]);

  useEffect(() => {
    if (strikes.length === 0) {
      setStrike(null);
      return;
    }
    if (strike != null && strikes.includes(strike)) return;

    if (underlyingPrice != null) {
      const closest = strikes.reduce((best, s) =>
        Math.abs(s - underlyingPrice) < Math.abs(best - underlyingPrice) ? s : best
      );
      setStrike(closest);
    } else {
      setStrike(strikes[Math.floor(strikes.length / 2)] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strikes]);

  return { expirationIndex, setExpirationIndex, strike, setStrike, expiration, strikes };
}

type MiniSelector = ReturnType<typeof useMiniStrikeSelector>;

function MiniSelectorFields({
  label,
  options,
  sel,
}: {
  label: string;
  options: OptionsResponse;
  sel: MiniSelector;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">{label}</span>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          DTE / Expiration
          <select
            value={sel.expirationIndex}
            onChange={(e) => sel.setExpirationIndex(Number(e.target.value))}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
          >
            {options.expirations.map((exp, i) => (
              <option key={exp.expirationDate} value={i}>
                {exp.dte}d · {formatMonthDay(exp.expirationDate)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Strike
          <select
            value={sel.strike ?? ""}
            onChange={(e) => sel.setStrike(Number(e.target.value))}
            disabled={sel.strikes.length === 0}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            {sel.strikes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode badges -- deliberately distinct colors + explicit wording, not just a
// tooltip, so "your position" and "hypothetical" can never be confused.
// ---------------------------------------------------------------------------

function YourPositionBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Your Position
    </span>
  );
}

function HypotheticalBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Hypothetical -- no tracked position
    </span>
  );
}

// ---------------------------------------------------------------------------
// Entry Score badge -- reuses lib/entry-score.ts's combineWithStrikeCushion
// (the exact same tier-mapping function entry-score-panel.tsx calls) rather
// than reimplementing the total/tier logic. Same visual language as that
// panel's tier styling.
// ---------------------------------------------------------------------------

function tierClasses(tier: string): { text: string; border: string; bg: string } {
  if (tier.startsWith("SELL")) return { text: "text-accent", border: "border-accent/40", bg: "bg-accent/5" };
  if (tier === "CONSIDER SKIPPING") return { text: "text-yellow-400", border: "border-yellow-500/40", bg: "bg-yellow-500/5" };
  return { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/5" };
}

/**
 * The completed 0-10 score for THIS specific selected contract --
 * IV/Events/Relative Strength come from the ticker-level Entry Score
 * already fetched for the page (identical regardless of which strike is
 * selected), while Skew and Technical/EM Cushion come from this panel's
 * own per-side computation (scoped to the exact selected expiration and
 * strike, unlike the ticker-level route's fixed front-month skew read).
 * The combination itself is NOT reimplemented -- this mirrors
 * scoreTickerLevel's own partialTotal formula exactly and calls the
 * real combineWithStrikeCushion for the total/tier, the same function
 * entry-score-panel.tsx uses.
 */
function computeCompletedScore(
  tickerLevel: EntryScoreResponse | null | undefined,
  side: ComparisonSideResult
): { total: number; tier: string } | null {
  if (!tickerLevel) return null;
  const partialTotal =
    (tickerLevel.ivComponent.score ?? 0) +
    tickerLevel.eventComponent.catalystScore +
    tickerLevel.eventComponent.alignmentScore +
    (side.skewComponent.score ?? 0) +
    (tickerLevel.relativeStrengthComponent.score ?? 0);
  return combineWithStrikeCushion(partialTotal, side.cushionScore);
}

function EntryScoreBadge({ score }: { score: { total: number; tier: string } }) {
  const c = tierClasses(score.tier);
  return (
    <div className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${c.border} ${c.bg}`}>
      <span className="text-[11px] uppercase tracking-wide text-muted">Entry Score (this contract)</span>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-xl font-bold ${c.text}`}>
          {score.total.toFixed(1)}
          <span className="text-xs font-normal text-muted">/10</span>
        </span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${c.text} ${c.border}`}>
          {score.tier}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result cards -- identical row order on both sides (Part A) so equivalent
// metrics line up horizontally: Premium/Capital, Yield, Worst-case outcome,
// Assignment Prob/Touch, EM Cushion, Skew.
// ---------------------------------------------------------------------------

function CardStat({ label, value, indicatorId }: { label: string; value: string; indicatorId?: string }) {
  const indicator = indicatorId ? guidanceIndicatorById(indicatorId) : undefined;
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        {label}
        {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
      </span>
      <span className="font-mono text-lg font-semibold text-foreground">{value}</span>
    </div>
  );
}

function skewDetail(side: ComparisonSideResult): string {
  if (side.skewComponent.score == null) return side.skewComponent.note ?? "—";
  const skew = side.skewComponent.skew;
  const pts = skew ? Math.abs(skew.skew * 100).toFixed(1) : "—";
  const lean = skew?.lean ?? "flat";
  return `${side.skewComponent.score.toFixed(1)} (${lean}, ${pts}pt)`;
}

function structuralDetail(side: ComparisonSideResult): string {
  if (side.emCushion == null) return "—";
  const em = `${side.emCushion.toFixed(2)}x expected move`;
  const structural = side.structuralConfirmation?.confirmed
    ? `, ✓ ${side.structuralConfirmation.referenceLabel}`
    : "";
  return `${em}${structural} (score ${side.cushionScore != null ? side.cushionScore.toFixed(1) : "—"})`;
}

function CallCard({ side, score }: { side: ComparisonSideResult; score: { total: number; tier: string } | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-base font-semibold text-foreground">
          {side.strike} C · {side.dte}d
        </span>
        <span className="text-xs text-muted">exp {side.expirationDate}</span>
      </div>

      {score && <EntryScoreBadge score={score} />}

      {/* Row 1 */}
      <div className="grid grid-cols-2 gap-2">
        <CardStat label="Premium" value={formatCurrency(side.premium)} />
        <CardStat label="Capital Required" value={`${formatCurrency(side.capitalRequired, 0)} (using held shares)`} />
      </div>

      {/* Row 2 */}
      <CardStat
        label="Annualized Yield on Capital"
        value={formatPercent((side.annualizedYieldOnCapital ?? 0) * 100)}
      />

      {/* Row 3 */}
      <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">Guaranteed Realized Gain if Assigned</span>
        <span className="font-mono text-xl font-bold text-accent">
          {formatCurrency(side.worstCaseRealizedGain)}
        </span>
        <span className="text-xs text-muted">
          Est. further upside forgone if called away: ~{formatCurrency(side.upsideForgoneEstimate)} (rough EM-based estimate, not owed money)
        </span>
      </div>

      {/* Row 4 */}
      <div className="grid grid-cols-2 gap-2">
        <CardStat
          label="Assignment Probability"
          value={side.assignmentProbability ?? "—"}
          indicatorId="assignment-probability"
        />
        <CardStat label="Probability of Touch" value={side.probabilityOfTouch ?? "—"} indicatorId="probability-of-touch" />
      </div>

      {/* Row 5 */}
      <CardStat label="EM Cushion + Structural" value={structuralDetail(side)} indicatorId="technical-em-cushion" />

      {/* Row 6 */}
      <CardStat label="Skew Contribution" value={skewDetail(side)} indicatorId="volatility-skew" />
    </div>
  );
}

function PutCard({
  side,
  ninetyDayRange,
  score,
}: {
  side: ComparisonSideResult;
  ninetyDayRange: { high: number; low: number } | null;
  score: { total: number; tier: string } | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-base font-semibold text-foreground">
          {side.strike} P · {side.dte}d
        </span>
        <span className="text-xs text-muted">exp {side.expirationDate}</span>
      </div>

      {score && <EntryScoreBadge score={score} />}

      {/* Row 1 */}
      <div className="grid grid-cols-2 gap-2">
        <CardStat label="Premium" value={formatCurrency(side.premium)} />
        <CardStat label="Capital Required" value={formatCurrency(side.capitalRequired, 0)} />
      </div>

      {/* Row 2 */}
      <CardStat
        label="Annualized Yield on Capital"
        value={formatPercent((side.annualizedYieldOnCapital ?? 0) * 100)}
      />

      {/* Row 3 */}
      <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">Effective New Cost Basis if Assigned</span>
        <span className="font-mono text-xl font-bold text-foreground">
          {formatCurrency(side.worstCaseEffectiveBasis)}
        </span>
        {ninetyDayRange && (
          <span className="text-xs text-muted">
            For context, this ticker&rsquo;s 90-day trading range: {formatCurrency(ninetyDayRange.low, 0)} –{" "}
            {formatCurrency(ninetyDayRange.high, 0)}
          </span>
        )}
      </div>

      {/* Row 4 */}
      <div className="grid grid-cols-2 gap-2">
        <CardStat
          label="Assignment Probability"
          value={side.assignmentProbability ?? "—"}
          indicatorId="assignment-probability"
        />
        <CardStat label="Probability of Touch" value={side.probabilityOfTouch ?? "—"} indicatorId="probability-of-touch" />
      </div>

      {/* Row 5 */}
      <CardStat label="EM Cushion + Structural" value={structuralDetail(side)} indicatorId="technical-em-cushion" />

      {/* Row 6 */}
      <CardStat label="Skew Contribution" value={skewDetail(side)} indicatorId="volatility-skew" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared context strip
// ---------------------------------------------------------------------------

function directionalEdgeSentence(edge: ComparisonResponse["directionalEdge"]): string {
  if (edge === "unclear") {
    return "No clear directional edge here -- trend and relative strength are roughly in line, so skew and capital efficiency are the more decisive factors between these two.";
  }
  if (edge === "bullish") {
    return "Trend and relative strength currently lean bullish for this ticker.";
  }
  return "Trend and relative strength currently lean bearish for this ticker.";
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ComparisonPanel({
  symbol,
  options,
  underlyingPrice,
  putScore,
  callScore,
}: {
  symbol: string;
  options: OptionsResponse;
  underlyingPrice: number | null;
  /** Ticker-level Entry Score, already fetched once for the page (Phase 24) -- reused here rather than fetched a second time. */
  putScore: FetchState<EntryScoreResponse>;
  callScore: FetchState<EntryScoreResponse>;
}) {
  const putSel = useMiniStrikeSelector(options, underlyingPrice);
  const callSel = useMiniStrikeSelector(options, underlyingPrice);
  // Hypothetical mode only -- stays empty (and unused in the query) until
  // either the user types a value or the first response tells us the
  // server-side default (today's price), at which point it's prefilled so
  // the field always shows a real number, never a blank placeholder.
  const [hypotheticalCostBasisInput, setHypotheticalCostBasisInput] = useState("");

  const putExpirationDate = putSel.expiration?.expirationDate ?? null;
  const callExpirationDate = callSel.expiration?.expirationDate ?? null;

  const queryUrl = useMemo(() => {
    if (putSel.strike == null || callSel.strike == null || putExpirationDate == null || callExpirationDate == null) {
      return null;
    }
    const params = new URLSearchParams({
      putStrike: String(putSel.strike),
      putExpiration: putExpirationDate,
      callStrike: String(callSel.strike),
      callExpiration: callExpirationDate,
    });
    if (hypotheticalCostBasisInput.trim() !== "") {
      params.set("hypotheticalCostBasis", hypotheticalCostBasisInput);
    }
    return `/api/compare/${symbol}?${params.toString()}`;
  }, [symbol, putSel.strike, callSel.strike, putExpirationDate, callExpirationDate, hypotheticalCostBasisInput]);

  const comparison = useJsonFetch<ComparisonResponse>(queryUrl);

  // Prefill the editable field from the server's own default (today's
  // price) the first time a hypothetical-mode response arrives -- only
  // when the user hasn't already typed something, so this never
  // clobbers an in-progress edit.
  useEffect(() => {
    if (comparison.data?.mode === "hypothetical" && hypotheticalCostBasisInput === "") {
      setHypotheticalCostBasisInput(String(comparison.data.costBasis));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison.data]);

  const trendIndicator = guidanceIndicatorById("trend");
  const relativeStrengthIndicator = guidanceIndicatorById("relative-strength");

  const callEntryScore = comparison.data ? computeCompletedScore(callScore.data, comparison.data.callSide) : null;
  const putEntryScore = comparison.data ? computeCompletedScore(putScore.data, comparison.data.putSide) : null;

  return (
    <Section title="Covered Call vs. Cash-Secured Put">
      <div className="flex flex-wrap items-center gap-2">
        {comparison.data?.mode === "your-position" && <YourPositionBadge />}
        {comparison.data?.mode === "hypothetical" && <HypotheticalBadge />}
      </div>

      {comparison.data?.mode === "your-position" && (
        <p className="text-sm text-muted">
          Pick a strike/DTE independently on each side -- these don&rsquo;t need to match. Cost basis is your actual
          tracked position: {formatCurrency(comparison.data.costBasis)} across {comparison.data.sharesOwned} shares.
        </p>
      )}

      {comparison.data?.mode === "hypothetical" && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm text-muted">
            No open position tracked for {symbol} -- exploring a hypothetical {comparison.data.sharesOwned}-share
            covered call / cash-secured put comparison instead. Pick a strike/DTE independently on each side.
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Hypothetical Cost Basis (call side only -- puts never depend on one)
            <input
              type="number"
              step="0.01"
              value={hypotheticalCostBasisInput}
              onChange={(e) => setHypotheticalCostBasisInput(e.target.value)}
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <p className="text-[11px] font-medium text-amber-300">
            Exploring what-if numbers, not your actual cost basis.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniSelectorFields label="Call side" options={options} sel={callSel} />
        <MiniSelectorFields label="Put side" options={options} sel={putSel} />
      </div>

      {comparison.loading && <SkeletonLines count={4} />}
      {comparison.error && <ErrorNote message={comparison.error} />}

      {comparison.data && (
        <>
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background px-3 py-2.5">
            <SubsectionHeader title="Shared Context" />
            <p className="flex items-center gap-2 text-sm text-foreground">
              {comparison.data.trendDescription}
              {trendIndicator && <ImportanceBadge tier={trendIndicator.importanceTier} />}
            </p>
            <p className="flex items-center gap-2 text-sm text-foreground">
              {comparison.data.relativeStrengthSummary}
              {relativeStrengthIndicator && <ImportanceBadge tier={relativeStrengthIndicator.importanceTier} />}
            </p>
            <p className="text-sm text-foreground">{directionalEdgeSentence(comparison.data.directionalEdge)}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CallCard side={comparison.data.callSide} score={callEntryScore} />
            <PutCard side={comparison.data.putSide} ninetyDayRange={comparison.data.ninetyDayRange} score={putEntryScore} />
          </div>

          <p className="text-xs text-muted">
            Capital use, upside participation, and premium efficiency trade off differently between these two --
            weigh against your own priorities. Contracts sized to {comparison.data.contracts} (
            {comparison.data.mode === "your-position"
              ? `what your ${comparison.data.sharesOwned} shares support`
              : `hypothetical ${comparison.data.sharesOwned}-share position`}
            ).
          </p>
        </>
      )}
    </Section>
  );
}
