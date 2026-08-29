"use client";

import { useJsonFetch } from "@/lib/use-json-fetch";
import type { InsiderActivityResponse, InsiderTransaction } from "@/types/api";
import { formatCompactNumber, formatCurrency, formatDate } from "@/lib/format";

function usdCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${formatCompactNumber(Math.abs(value))}`;
}

function TransactionRow({ tx }: { tx: InsiderTransaction }) {
  const isBuy = tx.code === "P";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-foreground">
          {tx.insiderName} <span className="text-xs text-muted">({tx.role})</span>
        </span>
        <span className="text-xs text-muted">{formatDate(tx.transactionDate)}</span>
      </div>
      <div className="flex items-center gap-2 font-mono text-sm">
        <span className={isBuy ? "text-accent" : "text-red-400"}>{isBuy ? "Buy" : "Sell"}</span>
        <span className="text-foreground">
          {tx.shares.toLocaleString()} @ {formatCurrency(tx.pricePerShare)}
        </span>
        <span className="text-muted">({usdCompact(tx.valueUsd)})</span>
      </div>
    </div>
  );
}

export function InsiderActivityPanel({ ticker }: { ticker: string }) {
  const { data, loading, error } = useJsonFetch<InsiderActivityResponse>(`/api/insider/${ticker}`);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-[11px] uppercase tracking-wide text-muted">Insider Activity (30d)</span>

      {loading && <p className="text-sm text-muted">Checking SEC EDGAR…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {data && data.summary === null && (
        <p className="text-sm text-muted">
          No SEC EDGAR record found for {ticker} -- either not a US reporting company, or the ticker
          couldn&rsquo;t be resolved to a CIK.
        </p>
      )}

      {data && data.summary && data.summary.purchaseCount === 0 && data.summary.saleCount === 0 && (
        <p className="text-sm text-muted">
          No Form 4 insider purchases or sales reported for {ticker} in the last {data.summary.windowDays} days.
        </p>
      )}

      {data && data.summary && (data.summary.purchaseCount > 0 || data.summary.saleCount > 0) && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed text-foreground">
            {data.summary.purchaseCount} insider purchase{data.summary.purchaseCount === 1 ? "" : "s"},{" "}
            {data.summary.saleCount} sale{data.summary.saleCount === 1 ? "" : "s"}, net{" "}
            <span className={data.summary.netValueUsd >= 0 ? "text-accent" : "text-red-400"}>
              {usdCompact(Math.abs(data.summary.netValueUsd))}
            </span>{" "}
            {data.summary.netValueUsd >= 0 ? "bought" : "sold"} over the last {data.summary.windowDays} days.
          </p>
          <div className="flex flex-col rounded-md border border-border bg-background px-3">
            {data.summary.recentTransactions.map((tx, i) => (
              <TransactionRow key={`${tx.transactionDate}-${i}`} tx={tx} />
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted">
        Sourced from SEC EDGAR Form 4 filings -- open-market purchases and sales only (grants, awards, and option
        exercises excluded). Supplementary context, not a scored input.
      </p>
    </div>
  );
}
