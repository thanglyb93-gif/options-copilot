import type { IvHistoryResponse, OptionsResponse, QuoteResponse } from "@/types/api";
import { percentileRank } from "@/lib/volatility";
import { formatPercent } from "@/lib/format";

function pct(value: number | null): string {
  return value != null ? formatPercent(value * 100, 1) : "—";
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

  const rank =
    ivHistory.hasEnoughHistory && iv != null
      ? percentileRank(iv, ivHistory.ivValues)
      : null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">Front-Month ATM IV</span>
        <span className="font-mono text-sm text-foreground">{pct(iv)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">30d HV</span>
        <span className="font-mono text-sm text-foreground">{pct(hv)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">IV / HV</span>
        <span className="font-mono text-sm text-foreground">
          {ratio != null ? ratio.toFixed(2) : "—"}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">IV Rank</span>
        <span className="font-mono text-sm text-foreground">
          {rank != null
            ? `${rank.toFixed(0)}%ile`
            : `Building history (${ivHistory.count}/${ivHistory.needed} days)`}
        </span>
      </div>
    </div>
  );
}
