import type { AssignmentOpportunityCostResult } from "@/types/api";
import { formatCurrency } from "@/lib/format";

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

/**
 * A quantified comparison, not a directive -- deliberately no red/green
 * "good/bad" color-coding on the headline number. A positive
 * costBasisDelta means assignment is WORSE (a higher cost basis), the
 * opposite of this app's usual "positive = green = good" convention, so
 * applying that convention here would silently smuggle in a directive
 * through color alone. Neutral styling throughout; the narrative states
 * the numbers plainly and lets the user draw their own conclusion.
 */
export function AssignmentOpportunityCostPanel({ result }: { result: AssignmentOpportunityCostResult }) {
  const isPut = result.positionType === "cash_secured_put";
  const headline = isPut ? result.costBasisDelta : result.upsideForgoneIfAssigned;
  const headlineLabel = isPut ? "Cost-basis delta (assigned vs. fresh)" : "Upside forgone if assigned";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted">Assignment Opportunity Cost</span>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">If assigned</span>
          {result.positionType === "cash_secured_put" ? (
            <StatLine label="Effective cost basis" value={formatCurrency(result.ifAssigned.effectiveCostBasis)} />
          ) : (
            <>
              <StatLine label="Proceeds (per share)" value={formatCurrency(result.ifAssigned.proceeds)} />
              <StatLine label="Realized gain" value={formatCurrency(result.ifAssigned.realizedGain)} />
            </>
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">If closed now</span>
          {result.positionType === "cash_secured_put" ? (
            <>
              <StatLine label="Realized P/L" value={formatCurrency(result.ifCloseNow.realizedPL)} />
              <StatLine label="Fresh cost basis" value={formatCurrency(result.ifCloseNow.hypotheticalFreshBasis)} />
            </>
          ) : (
            <>
              <StatLine label="Realized P/L (option)" value={formatCurrency(result.ifCloseNow.realizedPL)} />
              <StatLine label="Shares retained value" value={formatCurrency(result.ifCloseNow.sharesRetainedValue)} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-border pt-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">{headlineLabel}</span>
        <span className="font-mono text-lg font-semibold text-foreground">{formatCurrency(headline)}</span>
      </div>

      <p className="text-xs text-muted">{result.narrative}</p>
    </div>
  );
}
