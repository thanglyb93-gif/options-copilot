"use client";

import { useMemo, useState } from "react";
import type { ContractRow, MaxPainResponse, OptionsResponse } from "@/types/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export interface ChainSelection {
  positionType: "covered_call" | "cash_secured_put";
  direction: "put" | "call";
  strike: number;
  premium: number;
  dte: number;
  expirationDate: string;
  contract: ContractRow;
}

function referencePremium(row: ContractRow): number | null {
  if (row.usingLastPriceFallback && row.lastPrice != null) return row.lastPrice;
  if (row.bid != null && row.ask != null) return (row.bid + row.ask) / 2;
  return row.ask ?? row.bid ?? null;
}

function ivCell(row: ContractRow) {
  if (row.usingLastPriceFallback) {
    return (
      <span
        className="text-muted"
        title="Market is closed -- no live bid/ask. Showing the last traded price and an IV/greeks estimate derived from it."
      >
        Last: {formatCurrency(row.lastPrice)} (as of close)
      </span>
    );
  }
  if (row.impliedVolatility == null) return <span className="text-muted">—</span>;
  if (row.ivUnreliable) return <span className="text-muted" title="Implausible IV from source data">unreliable</span>;
  return <span>{formatPercent(row.impliedVolatility * 100, 0)}</span>;
}

/** Background tint that darkens with cushion score -- a scannable green gradient. */
function cushionClasses(score: number | null): string {
  if (score == null) return "text-muted";
  if (score >= 2) return "bg-accent/30 text-foreground font-semibold";
  if (score >= 1.5) return "bg-accent/20 text-foreground";
  if (score >= 1) return "bg-accent/10 text-foreground";
  if (score >= 0.5) return "bg-accent/5 text-foreground";
  return "text-muted";
}

function CushionCell({ row }: { row?: ContractRow }) {
  if (!row || row.cushionScore == null) {
    return <td className="px-2 py-1 text-muted">—</td>;
  }
  const badge = row.structuralConfirmation?.confirmed;
  return (
    <td
      className={`px-2 py-1 ${cushionClasses(row.cushionScore)}`}
      title={badge ? `Structural confirmation: below/above ${row.structuralConfirmation!.referenceLabel}` : undefined}
    >
      {formatNumber(row.cushionScore, 1)}
      {badge && <span className="ml-0.5 text-accent">✓</span>}
    </td>
  );
}

export function OptionsChain({
  options,
  maxPain,
  onSelectContract,
}: {
  options: OptionsResponse;
  maxPain: MaxPainResponse | null;
  onSelectContract: (selection: ChainSelection) => void;
}) {
  const [expirationIndex, setExpirationIndex] = useState(options.defaultExpirationIndex);
  const expiration = options.expirations[expirationIndex];

  const rows = useMemo(() => {
    if (!expiration) return [];
    const byStrike = new Map<number, { call?: ContractRow; put?: ContractRow }>();
    for (const call of expiration.calls) {
      byStrike.set(call.strike, { ...byStrike.get(call.strike), call });
    }
    for (const put of expiration.puts) {
      byStrike.set(put.strike, { ...byStrike.get(put.strike), put });
    }
    return Array.from(byStrike.entries())
      .map(([strike, v]) => ({ strike, ...v }))
      .sort((a, b) => a.strike - b.strike);
  }, [expiration]);

  const maxPainStrike =
    maxPain && expiration && maxPain.expirationDate === expiration.expirationDate
      ? maxPain.maxPainStrike
      : null;

  if (!expiration) {
    return <p className="text-sm text-muted">No expirations available.</p>;
  }

  function selectCall(strike: number, call: ContractRow) {
    const premium = referencePremium(call);
    if (premium == null || !expiration) return;
    onSelectContract({
      positionType: "covered_call",
      direction: "call",
      strike,
      premium,
      dte: expiration.dte,
      expirationDate: expiration.expirationDate,
      contract: call,
    });
  }

  function selectPut(strike: number, put: ContractRow) {
    const premium = referencePremium(put);
    if (premium == null || !expiration) return;
    onSelectContract({
      positionType: "cash_secured_put",
      direction: "put",
      strike,
      premium,
      dte: expiration.dte,
      expirationDate: expiration.expirationDate,
      contract: put,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={expirationIndex}
          onChange={(e) => setExpirationIndex(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        >
          {options.expirations.map((exp, i) => (
            <option key={exp.expirationDate} value={i}>
              {exp.expirationDate} ({exp.dte}d)
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {expiration.dte} DTE · click a strike to load its full decision breakdown below
        </span>
        {maxPainStrike != null ? (
          <span className="text-xs text-muted">
            Max pain: <span className="font-mono text-foreground">{maxPainStrike}</span>
          </span>
        ) : (
          maxPain && (
            <span className="text-xs text-muted">
              Max pain only available for the nearest expiration ({maxPain.expirationDate})
            </span>
          )
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-right font-mono text-xs">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-right font-normal">Bid</th>
              <th className="px-2 py-1 text-right font-normal">Ask</th>
              <th className="px-2 py-1 text-right font-normal">Vol</th>
              <th className="px-2 py-1 text-right font-normal">OI</th>
              <th className="px-2 py-1 text-right font-normal">IV</th>
              <th className="px-2 py-1 text-right font-normal">Cushion</th>
              <th className="px-2 py-1 text-right font-normal">Assign %</th>
              <th className="px-2 py-1 text-right font-normal">Delta</th>
              <th className="px-2 py-1 text-center font-normal text-foreground">Strike</th>
              <th className="px-2 py-1 text-left font-normal">Delta</th>
              <th className="px-2 py-1 text-left font-normal">Assign %</th>
              <th className="px-2 py-1 text-left font-normal">Cushion</th>
              <th className="px-2 py-1 text-left font-normal">IV</th>
              <th className="px-2 py-1 text-left font-normal">OI</th>
              <th className="px-2 py-1 text-left font-normal">Vol</th>
              <th className="px-2 py-1 text-left font-normal">Bid</th>
              <th className="px-2 py-1 text-left font-normal">Ask</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ strike, call, put }) => {
              const rowFlagged = call?.inTargetBand || put?.inTargetBand;
              const isMaxPain = maxPainStrike === strike;
              return (
                <tr
                  key={strike}
                  className={`border-t border-border ${rowFlagged ? "bg-accent/10" : ""}`}
                >
                  <td
                    className={`px-2 py-1 ${call ? "cursor-pointer hover:underline" : "text-muted"}`}
                    onClick={() => call && selectCall(strike, call)}
                  >
                    {formatCurrency(call?.bid ?? null)}
                  </td>
                  <td className="px-2 py-1">{formatCurrency(call?.ask ?? null)}</td>
                  <td className="px-2 py-1">{call?.volume ?? "—"}</td>
                  <td className="px-2 py-1">{call?.openInterest ?? "—"}</td>
                  <td className="px-2 py-1">{call ? ivCell(call) : "—"}</td>
                  <CushionCell row={call} />
                  <td className="px-2 py-1">{call?.assignmentProbability ?? "—"}</td>
                  <td className="px-2 py-1">{call?.delta != null ? formatNumber(call.delta, 2) : "—"}</td>
                  <td
                    className={`px-2 py-1 text-center text-sm text-foreground ${
                      isMaxPain ? "font-semibold text-accent" : ""
                    }`}
                    title={isMaxPain ? "Max pain strike" : undefined}
                  >
                    {isMaxPain ? `★ ${strike}` : strike}
                  </td>
                  <td className="px-2 py-1 text-left">
                    {put?.delta != null ? formatNumber(put.delta, 2) : "—"}
                  </td>
                  <td className="px-2 py-1 text-left">{put?.assignmentProbability ?? "—"}</td>
                  <CushionCell row={put} />
                  <td className="px-2 py-1 text-left">{put ? ivCell(put) : "—"}</td>
                  <td className="px-2 py-1 text-left">{put?.openInterest ?? "—"}</td>
                  <td className="px-2 py-1 text-left">{put?.volume ?? "—"}</td>
                  <td className="px-2 py-1 text-left">{formatCurrency(put?.bid ?? null)}</td>
                  <td
                    className={`px-2 py-1 text-left ${put ? "cursor-pointer hover:underline" : "text-muted"}`}
                    onClick={() => put && selectPut(strike, put)}
                  >
                    {formatCurrency(put?.ask ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
