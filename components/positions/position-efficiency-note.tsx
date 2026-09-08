import type { PositionEfficiencyResult } from "@/types/api";
import { formatCurrency, formatPercent } from "@/lib/format";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";

/**
 * Phase 36 -- realized annualized covered-call premium yield for this
 * stock-backed holding vs. the portfolio's own average (lib/position-
 * efficiency.ts). A plain comparison, never a directive to sell -- the
 * flagged message states what the numbers show and leaves the
 * conclusion to the reader. Always states the KNOWN LIMITATION when the
 * comparison is shown, and states plainly (never silently) when the
 * sample size is too small for the average to mean anything.
 */
export function PositionEfficiencyNote({ efficiency }: { efficiency: PositionEfficiencyResult }) {
  const indicator = guidanceIndicatorById("position-efficiency");

  if (efficiency.tickerYieldPct == null || efficiency.capitalCommitted == null) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-3">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
          Premium Efficiency
          {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
        </span>
        <p className="text-xs text-muted">
          Not enough recorded cost basis/shares on this ticker&rsquo;s logged position(s) to compute a yield.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        Premium Efficiency
        {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
      </span>

      <p className="text-sm text-foreground">
        Premium efficiency: <span className="font-mono">{formatPercent(efficiency.tickerYieldPct)} annualized</span>
        {efficiency.portfolioAverageYieldPct != null && (
          <>
            {" "}
            (portfolio avg: <span className="font-mono">{formatPercent(efficiency.portfolioAverageYieldPct)}</span>)
          </>
        )}
      </p>

      <p className="text-[11px] text-muted">
        {formatCurrency(efficiency.totalPremiumCollected)} in premium collected over {efficiency.daysTracked} tracked
        day{efficiency.daysTracked === 1 ? "" : "s"} on {formatCurrency(efficiency.capitalCommitted, 0)} committed
        capital.
      </p>

      {efficiency.sampleSizeInsufficient ? (
        <p className="text-[11px] text-muted">
          Portfolio-average comparison isn&rsquo;t meaningful yet -- only {efficiency.portfolioTickerCount} ticker
          {efficiency.portfolioTickerCount === 1 ? "" : "s"} with logged covered-call history (need{" "}
          {3 - efficiency.portfolioTickerCount > 0 ? `at least 3` : "3"}).
        </p>
      ) : (
        efficiency.flagged && (
          <div className="w-fit rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
            ⚠ This position has generated less premium income relative to capital than your typical covered-call
            position -- worth considering whether this capital could work harder elsewhere.
          </div>
        )
      )}

      <p className="text-[10px] leading-relaxed text-muted">
        Only reflects premium collected on positions logged in this app -- it can&rsquo;t see any covered-call
        history for this ticker from before it was first tracked here.
      </p>
    </div>
  );
}
