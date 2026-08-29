import type { AssignmentOpportunityCostResult, ScenarioAlignmentResult } from "@/types/api";
import { formatCurrency } from "@/lib/format";

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

/** The one line every "If closed now" box leads with -- the actual, explicit cost of closing, not left implied by the derived deltas below it. */
function PrimaryStatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-mono text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}

function TrendSentimentSection({ result }: { result: ScenarioAlignmentResult }) {
  const alignmentLabel =
    result.alignment === "aligned" ? "Aligned" : result.alignment === "conflicting" ? "Conflicting" : "Insufficient signal";

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-[11px] uppercase tracking-wide text-muted">Trend &amp; Sentiment Context</span>
      <p className="text-[11px] leading-relaxed text-muted">
        Reflects recent price trend and news sentiment, not a forecast of future price movement. Markets are
        inherently unpredictable in the short term.
      </p>

      <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
        <StatLine
          label="SMA trend"
          value={
            result.trendClassification === "uptrend"
              ? "Uptrend"
              : result.trendClassification === "downtrend"
                ? "Downtrend"
                : result.trendClassification === "mixed"
                  ? "Mixed"
                  : "Unavailable"
          }
        />
        <StatLine
          label="News/AI directional lean"
          value={result.lean.charAt(0).toUpperCase() + result.lean.slice(1)}
        />
        <StatLine label="Signal read" value={alignmentLabel} />
      </div>

      <p className="text-xs text-muted">{result.leanRationale}</p>
      <p className="text-xs text-foreground">{result.interpretation}</p>

      {result.caveat && (
        <p className="text-xs text-muted">
          <span className="font-medium">Caveat:</span> {result.caveat}
        </p>
      )}
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
 * the numbers plainly and lets the user draw their own conclusion. The
 * Trend & Sentiment Context sub-section is explicitly NOT a forecast --
 * see its own permanent, visible disclaimer.
 */
export function AssignmentOpportunityCostPanel({
  result,
  alignment,
}: {
  result: AssignmentOpportunityCostResult;
  alignment: ScenarioAlignmentResult | null;
}) {
  const isPut = result.positionType === "cash_secured_put";
  const headline = isPut ? result.costBasisDelta : result.upsideForgoneIfAssigned;
  const headlineLabel = isPut ? "Cost-basis delta (assigned vs. fresh)" : "Upside forgone if assigned";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted">Assignment Opportunity Cost</span>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
          <PrimaryStatLine
            label={result.positionType === "cash_secured_put" ? "Realized P/L" : "Realized P/L (option)"}
            value={formatCurrency(result.ifCloseNow.realizedPL)}
          />
          {result.positionType === "cash_secured_put" ? (
            <StatLine label="Fresh cost basis" value={formatCurrency(result.ifCloseNow.hypotheticalFreshBasis)} />
          ) : (
            <StatLine label="Shares retained value" value={formatCurrency(result.ifCloseNow.sharesRetainedValue)} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-border pt-2">
        <span className="text-[11px] uppercase tracking-wide text-muted">{headlineLabel}</span>
        <span className="font-mono text-lg font-semibold text-foreground">{formatCurrency(headline)}</span>
      </div>

      <p className="text-xs text-muted">{result.narrative}</p>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-[11px] uppercase tracking-wide text-muted">Capital / Cash Picture</span>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {result.positionType === "cash_secured_put" ? (
            <>
              <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
                <StatLine label="Capital freed if closed now" value={formatCurrency(result.capital.capitalFreedIfCloseNow)} />
                <StatLine label="Cost to rebuy fresh shares" value={formatCurrency(result.capital.ifRebuyFreshShares)} />
              </div>
              <div className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-muted">Net cash delta</span>
                <span className="font-mono text-base font-semibold text-foreground">
                  {formatCurrency(result.capital.netCashDelta)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 sm:col-span-2">
              <StatLine label="Cash received if assigned" value={formatCurrency(result.capital.cashReceivedIfAssigned)} />
              <StatLine label="Cash received if closed now" value={formatCurrency(result.capital.cashReceivedIfCloseNow)} />
            </div>
          )}
        </div>
        <p className="text-xs text-muted">{result.capitalNarrative}</p>
      </div>

      {alignment && <TrendSentimentSection result={alignment} />}
    </div>
  );
}
