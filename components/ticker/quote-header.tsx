import type { QuoteResponse, ScreenerResponse } from "@/types/api";
import { describeTrend } from "@/lib/trend";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import type { FetchState } from "@/lib/use-json-fetch";
import {
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatPercent,
} from "@/lib/format";
import { SubsectionHeader } from "./section";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

export function QuoteHeader({
  quote,
  screener,
}: {
  quote: QuoteResponse;
  /** Same relative-strength evaluation the Screener computes for this ticker -- reused, not recomputed, so the two surfaces can never disagree. */
  screener: FetchState<ScreenerResponse>;
}) {
  const changeUp = (quote.dayChange ?? 0) >= 0;
  const trend =
    quote.price != null
      ? describeTrend({
          price: quote.price,
          sma20: quote.sma20,
          sma50: quote.sma50,
          sma200: quote.sma200,
        })
      : null;
  const trendIndicator = guidanceIndicatorById("trend");
  const relativeStrengthIndicator = guidanceIndicatorById("relative-strength");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-3xl font-semibold text-foreground">
          {formatCurrency(quote.price)}
        </span>
        <span
          className={`font-mono text-sm ${changeUp ? "text-accent" : "text-red-400"}`}
        >
          {changeUp ? "+" : ""}
          {formatCurrency(quote.dayChange, 2)} ({formatPercent(quote.dayChangePercent)})
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <SubsectionHeader title="Fundamentals" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat
            label="52w High/Low"
            value={`${formatCurrency(quote.fiftyTwoWeekHigh, 0)} / ${formatCurrency(quote.fiftyTwoWeekLow, 0)}`}
          />
          <Stat label="% From 52w High" value={formatPercent(quote.percentFrom52wHigh)} />
          <Stat
            label="P/E (Fwd/Trail)"
            value={`${quote.peRatioForward?.toFixed(1) ?? "—"} / ${quote.peRatioTrailing?.toFixed(1) ?? "—"}`}
          />
          <Stat label="Market Cap" value={formatCompactNumber(quote.marketCap)} />
          <Stat
            label="Div Yield"
            value={quote.dividendYield != null ? `${quote.dividendYield.toFixed(2)}%` : "—"}
          />
          <Stat label="Next Ex-Div" value={formatDate(quote.nextExDividendDate)} />
          <Stat label="Beta" value={quote.beta != null ? quote.beta.toFixed(2) : "—"} />
        </div>
      </div>

      {(trend || screener.loading || screener.data) && (
        <div className="flex flex-col gap-1.5">
          <SubsectionHeader title="Trend & Relative Performance" />
          {trend && (
            <p className="flex items-center gap-2 text-sm text-foreground">
              {trend}
              {trendIndicator && <ImportanceBadge tier={trendIndicator.importanceTier} />}
            </p>
          )}
          {screener.loading && <p className="text-sm text-muted">Computing relative strength…</p>}
          {screener.data && (
            <p className="flex items-center gap-2 text-sm text-foreground">
              {screener.data.summary}
              {relativeStrengthIndicator && (
                <ImportanceBadge tier={relativeStrengthIndicator.importanceTier} />
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
