import type { IvHistoryResponse, OptionsResponse, QuoteResponse } from "@/types/api";
import { describeIvTermStructure, describeVolatilitySkew, percentileRank } from "@/lib/volatility";
import { describeRsi } from "@/lib/trend";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import { formatOrdinal, formatPercent } from "@/lib/format";
import { SubsectionHeader } from "./section";

function pct(value: number | null): string {
  return value != null ? formatPercent(value * 100, 1) : "—";
}

function StatLabel({ label, indicatorId }: { label: string; indicatorId?: string }) {
  const indicator = indicatorId ? guidanceIndicatorById(indicatorId) : undefined;
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
    </span>
  );
}

export function VolatilityPanel({
  options,
  quote,
  ivHistory,
}: {
  options: OptionsResponse;
  quote: QuoteResponse;
  ivHistory: IvHistoryResponse;
}) {
  const iv = options.frontMonthAtmIv;
  const hv = quote.hv30;
  const ratio = iv != null && hv != null && hv > 0 ? iv / hv : null;

  const ivPercentile =
    ivHistory.hasEnoughHistory && iv != null
      ? percentileRank(iv, ivHistory.ivValues)
      : null;

  const termStructureIndicator = guidanceIndicatorById("iv-term-structure");
  const skewIndicator = guidanceIndicatorById("volatility-skew");
  const rsiIndicator = guidanceIndicatorById("rsi");

  return (
    <div className="flex flex-col gap-3">
      <SubsectionHeader title="Volatility & Structure" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-muted">Front-Month ATM IV</span>
          <span className="font-mono text-sm text-foreground">{pct(iv)}</span>
          <span className="text-[10px] leading-tight text-muted">Feeds IV Percentile &amp; IV Term Structure below</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-muted">30d HV</span>
          <span className="font-mono text-sm text-foreground">{pct(hv)}</span>
          <span className="text-[10px] leading-tight text-muted">Feeds HV Percentile &amp; IV/HV ratio</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-muted">IV / HV</span>
          <span className="font-mono text-sm text-foreground">
            {ratio != null ? ratio.toFixed(2) : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <StatLabel label="IV Percentile" indicatorId="iv-percentile" />
          <span className="font-mono text-sm text-foreground">
            {ivPercentile != null
              ? formatOrdinal(ivPercentile)
              : `— (${ivHistory.count}/${ivHistory.needed})`}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <StatLabel label="HV Percentile" indicatorId="hv-percentile" />
          <span className="font-mono text-sm text-foreground">
            {quote.hvPercentile != null ? formatOrdinal(quote.hvPercentile) : "—"}
          </span>
        </div>
      </div>

      {options.termStructure && (
        <p className="flex items-center gap-2 text-sm text-foreground">
          {describeIvTermStructure(options.termStructure)}
          {termStructureIndicator && <ImportanceBadge tier={termStructureIndicator.importanceTier} />}
        </p>
      )}

      {options.volatilitySkew && (
        <p className="flex items-center gap-2 text-sm text-foreground">
          {describeVolatilitySkew(options.volatilitySkew)}
          {skewIndicator && <ImportanceBadge tier={skewIndicator.importanceTier} />}
        </p>
      )}

      {quote.rsi != null && (
        <p className="flex items-center gap-2 text-sm text-foreground">
          {describeRsi(quote.rsi)}
          {rsiIndicator && <ImportanceBadge tier={rsiIndicator.importanceTier} />}
        </p>
      )}
    </div>
  );
}
