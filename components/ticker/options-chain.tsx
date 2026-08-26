"use client";

import { useMemo, useState } from "react";
import type { ContractRow, MaxPainResponse, OptionsResponse } from "@/types/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export interface ChainSelection {
  positionType: "covered_call" | "cash_secured_put";
  strike: number;
  premium: number;
  dte: number;
}

function midPrice(row: ContractRow): number | null {
  if (row.bid != null && row.ask != null) return (row.bid + row.ask) / 2;
  return row.ask ?? row.bid ?? null;
}

function ivCell(row: ContractRow) {
  if (row.impliedVolatility == null) return <span className="text-muted">—</span>;
  if (row.ivUnreliable) return <span className="text-muted" title="Implausible IV from source data">unreliable</span>;
  return <span>{formatPercent(row.impliedVolatility * 100, 0)}</span>;
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
          {expiration.dte} DTE · click a strike to load it into the simulator
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
        <table className="w-full min-w-[720px] border-collapse text-right font-mono text-xs">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-right font-normal">Bid</th>
              <th className="px-2 py-1 text-right font-normal">Ask</th>
              <th className="px-2 py-1 text-right font-normal">Vol</th>
              <th className="px-2 py-1 text-right font-normal">OI</th>
              <th className="px-2 py-1 text-right font-normal">IV</th>
              <th className="px-2 py-1 text-right font-normal">Delta</th>
              <th className="px-2 py-1 text-center font-normal text-foreground">Strike</th>
              <th className="px-2 py-1 text-left font-normal">Delta</th>
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
                    onClick={() => {
                      if (!call) return;
                      const premium = midPrice(call);
                      if (premium == null) return;
                      onSelectContract({
                        positionType: "covered_call",
                        strike,
                        premium,
                        dte: expiration.dte,
                      });
                    }}
                  >
                    {formatCurrency(call?.bid ?? null)}
                  </td>
                  <td className="px-2 py-1">{formatCurrency(call?.ask ?? null)}</td>
                  <td className="px-2 py-1">{call?.volume ?? "—"}</td>
                  <td className="px-2 py-1">{call?.openInterest ?? "—"}</td>
                  <td className="px-2 py-1">{call ? ivCell(call) : "—"}</td>
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
                  <td className="px-2 py-1 text-left">{put ? ivCell(put) : "—"}</td>
                  <td className="px-2 py-1 text-left">{put?.openInterest ?? "—"}</td>
                  <td className="px-2 py-1 text-left">{put?.volume ?? "—"}</td>
                  <td className="px-2 py-1 text-left">{formatCurrency(put?.bid ?? null)}</td>
                  <td
                    className={`px-2 py-1 text-left ${put ? "cursor-pointer hover:underline" : "text-muted"}`}
                    onClick={() => {
                      if (!put) return;
                      const premium = midPrice(put);
                      if (premium == null) return;
                      onSelectContract({
                        positionType: "cash_secured_put",
                        strike,
                        premium,
                        dte: expiration.dte,
                      });
                    }}
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
