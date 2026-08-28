"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComparisonResponse, ComparisonSideResult, OptionsResponse } from "@/types/api";
import { useJsonFetch } from "@/lib/use-json-fetch";
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
// Result cards
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

function CallCard({ side }: { side: ComparisonSideResult }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-base font-semibold text-foreground">
          {side.strike} C · {side.dte}d
        </span>
        <span className="text-xs text-muted">exp {side.expirationDate}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CardStat label="Premium" value={formatCurrency(side.premium)} />
        <CardStat label="Annualized Yield on Capital" value={formatPercent((side.annualizedYieldOnCapital ?? 0) * 100)} />
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">
          Worst case (assignment) -- guaranteed realized gain
        </span>
        <span className="font-mono text-xl font-bold text-accent">
          {formatCurrency(side.worstCaseRealizedGain)}
        </span>
        <span className="text-xs text-muted">
          Est. further upside forgone if called away: ~{formatCurrency(side.upsideForgoneEstimate)} (rough EM-based estimate, not owed money)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CardStat
          label="Assignment Probability"
          value={side.assignmentProbability ?? "—"}
          indicatorId="assignment-probability"
        />
        <CardStat label="Probability of Touch" value={side.probabilityOfTouch ?? "—"} indicatorId="probability-of-touch" />
      </div>

      <CardStat label="EM Cushion + Structural" value={structuralDetail(side)} indicatorId="technical-em-cushion" />
      <CardStat label="Skew Contribution" value={skewDetail(side)} indicatorId="volatility-skew" />
    </div>
  );
}

function PutCard({ side, ninetyDayRange }: { side: ComparisonSideResult; ninetyDayRange: { high: number; low: number } | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-base font-semibold text-foreground">
          {side.strike} P · {side.dte}d
        </span>
        <span className="text-xs text-muted">exp {side.expirationDate}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CardStat label="Premium" value={formatCurrency(side.premium)} />
        <CardStat label="Capital Required" value={formatCurrency(side.capitalRequired, 0)} />
      </div>
      <CardStat
        label="Annualized Yield on Capital"
        value={formatPercent((side.annualizedYieldOnCapital ?? 0) * 100)}
      />

      <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">
          Worst case (assignment) -- effective new cost basis
        </span>
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

      <div className="grid grid-cols-2 gap-2">
        <CardStat
          label="Assignment Probability"
          value={side.assignmentProbability ?? "—"}
          indicatorId="assignment-probability"
        />
        <CardStat label="Probability of Touch" value={side.probabilityOfTouch ?? "—"} indicatorId="probability-of-touch" />
      </div>

      <CardStat label="EM Cushion + Structural" value={structuralDetail(side)} indicatorId="technical-em-cushion" />
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
}: {
  symbol: string;
  options: OptionsResponse;
  underlyingPrice: number | null;
}) {
  const putSel = useMiniStrikeSelector(options, underlyingPrice);
  const callSel = useMiniStrikeSelector(options, underlyingPrice);

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
    return `/api/compare/${symbol}?${params.toString()}`;
  }, [symbol, putSel.strike, callSel.strike, putExpirationDate, callExpirationDate]);

  const comparison = useJsonFetch<ComparisonResponse>(queryUrl);
  const trendIndicator = guidanceIndicatorById("trend");
  const relativeStrengthIndicator = guidanceIndicatorById("relative-strength");

  return (
    <Section title="Covered Call vs. Cash-Secured Put">
      <p className="text-sm text-muted">
        Pick a strike/DTE independently on each side -- these don&rsquo;t need to match. Cost basis is always your
        actual tracked position, {formatCurrency(comparison.data?.costBasis ?? null)} across{" "}
        {comparison.data?.sharesOwned ?? "—"} shares.
      </p>

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
            <CallCard side={comparison.data.callSide} />
            <PutCard side={comparison.data.putSide} ninetyDayRange={comparison.data.ninetyDayRange} />
          </div>

          <p className="text-xs text-muted">
            Capital use, upside participation, and premium efficiency trade off differently between these two --
            weigh against your own priorities. Contracts sized to {comparison.data.contracts} (what your{" "}
            {comparison.data.sharesOwned} shares support).
          </p>
        </>
      )}
    </Section>
  );
}
