"use client";

/**
 * Phase 38 -- Personalized Counterfactual Backtest. For each imported
 * (Phase 37) losing covered-call trade, shows what Phase 34's momentum-
 * adjusted cushion buffer would have suggested at that real historical
 * entry, replayed against real historical prices. CRITICAL FRAMING,
 * stated permanently and visibly here: this is a retrospective "what
 * if" using this app's own current methodology, not a claim the
 * alternative strike would definitely have been better in every way --
 * every card shows the avoided loss AND the reduced premium together,
 * never just the favorable half.
 */

import type { CounterfactualBacktestResponse, CounterfactualComparison } from "@/types/api";
import { useJsonFetch } from "@/lib/use-json-fetch";
import { formatCurrency, formatDate } from "@/lib/format";
import { SkeletonLines, ErrorNote } from "@/components/ticker/section";

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function ComparisonCard({ c }: { c: CounterfactualComparison }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-base font-semibold text-foreground">
          {c.ticker} {c.actual.strike}C
        </span>
        <span className="text-xs text-muted">
          Entered {formatDate(c.entryDate)} at {formatCurrency(c.entryPrice)} · exp {formatDate(c.expirationDate)} (
          {c.dte}d)
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">What actually happened</span>
          <StatLine label="Strike" value={`${c.actual.strike}`} />
          <StatLine label="Premium collected" value={formatCurrency(c.actual.totalPremium)} />
          <StatLine label="Realized P/L" value={formatCurrency(c.actual.realizedPL)} />
        </div>

        <div className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">
            Modeled: {c.momentumActive ? "momentum-adjusted" : "baseline"} strike
          </span>
          <StatLine label="Strike" value={`${c.counterfactual.strike} (${c.counterfactual.emCushionTarget.toFixed(2)}x EM target)`} />
          <StatLine label="Modeled premium" value={formatCurrency(c.counterfactual.totalPremium)} />
          <StatLine
            label="Modeled realized P/L"
            value={formatCurrency(c.counterfactual.realizedPL)}
          />
          <StatLine
            label="Would have finished"
            value={c.counterfactual.assigned ? `ITM at ${formatCurrency(c.counterfactual.finalPrice)}` : `OTM at ${formatCurrency(c.counterfactual.finalPrice)}`}
          />
        </div>
      </div>

      {c.momentumActive && c.momentumReason && (
        <p className="text-[11px] text-muted">
          Momentum conditions at entry: {c.momentumReason}
        </p>
      )}
      {!c.momentumActive && (
        <p className="text-[11px] text-muted">
          Momentum conditions weren&rsquo;t met at this historical entry -- the modeled strike above is this app&rsquo;s
          ordinary baseline EM-cushion targeting, not a momentum-adjusted one.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-muted">Avoided loss</span>
          <span className={`font-mono text-lg font-semibold ${c.avoidedLoss >= 0 ? "text-accent" : "text-red-400"}`}>
            {formatCurrency(c.avoidedLoss)}
          </span>
          <span className="text-[10px] text-muted">Modeled realized P/L minus what actually happened.</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-muted">Premium given up</span>
          <span className="font-mono text-lg font-semibold text-foreground">{formatCurrency(c.premiumForgone)}</span>
          <span className="text-[10px] text-muted">
            The wider strike would have collected this much less premium up front -- the real cost of the extra
            safety, not a free lunch.
          </span>
        </div>
      </div>
    </div>
  );
}

export function CounterfactualBacktestSummary() {
  const { data, loading, error } = useJsonFetch<CounterfactualBacktestResponse>("/api/counterfactual-backtest");

  if (loading) return <SkeletonLines count={3} />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  if (data.comparisons.length === 0 && data.skipped.length === 0) {
    return (
      <p className="text-sm text-muted">
        No imported losing covered-call trades yet. Import your trade history on the Positions page (Phase 37) to
        see this -- this can only replay trades actually logged in this app.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        Modeled comparison using real historical prices, not a guarantee. This replays this app&rsquo;s own current
        entry methodology against what actually happened -- it is not a claim the alternative strike would
        definitely have been better in every way. A wider strike always collects less premium up front; every card
        below shows that cost alongside the avoided loss, never just the favorable half.
      </p>

      {data.comparisons.map((c) => (
        <ComparisonCard key={c.positionId} c={c} />
      ))}

      {data.skipped.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">
            {data.skipped.length} losing trade{data.skipped.length === 1 ? "" : "s"} couldn&rsquo;t be modeled
          </summary>
          <ul className="mt-1 flex flex-col gap-1 pl-3 text-[11px] text-muted">
            {data.skipped.map((s) => (
              <li key={s.positionId}>
                {s.ticker}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
