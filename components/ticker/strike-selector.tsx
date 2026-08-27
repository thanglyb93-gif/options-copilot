"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContractRow, MaxPainResponse, OptionsResponse } from "@/types/api";
import { formatMonthDay } from "@/lib/format";

export interface StrikeSelection {
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

export function StrikeSelector({
  options,
  underlyingPrice,
  maxPain,
  onSelectionChange,
}: {
  options: OptionsResponse;
  underlyingPrice: number | null;
  maxPain: MaxPainResponse | null;
  onSelectionChange: (selection: StrikeSelection | null) => void;
}) {
  const [expirationIndex, setExpirationIndex] = useState(options.defaultExpirationIndex);
  const [strike, setStrike] = useState<number | null>(null);
  const [direction, setDirection] = useState<"put" | "call">("call");

  const expiration = options.expirations[expirationIndex];

  const strikes = useMemo(() => {
    if (!expiration) return [];
    const set = new Set<number>();
    expiration.calls.forEach((c) => set.add(c.strike));
    expiration.puts.forEach((p) => set.add(p.strike));
    return Array.from(set).sort((a, b) => a - b);
  }, [expiration]);

  // Pick a sensible default (closest to spot) whenever the strike list
  // changes and the current selection is no longer in it -- e.g. switching
  // to an expiration with a different strike ladder.
  useEffect(() => {
    if (strikes.length === 0) {
      setStrike(null);
      return;
    }
    if (strike != null && strikes.includes(strike)) return;

    if (underlyingPrice != null) {
      const closest = strikes.reduce((best, s) =>
        Math.abs(s - underlyingPrice) < Math.abs(best - underlyingPrice) ? s : best
      );
      setStrike(closest);
    } else {
      setStrike(strikes[Math.floor(strikes.length / 2)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strikes]);

  const contract = useMemo(() => {
    if (!expiration || strike == null) return undefined;
    const list = direction === "call" ? expiration.calls : expiration.puts;
    return list.find((c) => c.strike === strike);
  }, [expiration, strike, direction]);

  useEffect(() => {
    if (!expiration || strike == null || !contract) {
      onSelectionChange(null);
      return;
    }
    const premium = referencePremium(contract);
    if (premium == null) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({
      positionType: direction === "call" ? "covered_call" : "cash_secured_put",
      direction,
      strike,
      premium,
      dte: expiration.dte,
      expirationDate: expiration.expirationDate,
      contract,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiration, strike, direction, contract]);

  if (options.expirations.length === 0) {
    return <p className="text-sm text-muted">No expirations available.</p>;
  }

  const maxPainStrike =
    maxPain && expiration && maxPain.expirationDate === expiration.expirationDate
      ? maxPain.maxPainStrike
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          DTE / Expiration
          <select
            value={expirationIndex}
            onChange={(e) => setExpirationIndex(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {options.expirations.map((exp, i) => (
              <option key={exp.expirationDate} value={i}>
                {exp.dte}d · {formatMonthDay(exp.expirationDate)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Strike
          <select
            value={strike ?? ""}
            onChange={(e) => setStrike(Number(e.target.value))}
            disabled={strikes.length === 0}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            {strikes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-xs text-muted">
          Direction
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {(["put", "call"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded px-3 py-1 text-sm ${
                  direction === d
                    ? "bg-accent/15 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Sell {d === "put" ? "Put" : "Call"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {maxPainStrike != null ? (
        <span className="text-xs text-muted">
          Max pain for this expiration: <span className="font-mono text-foreground">{maxPainStrike}</span>
        </span>
      ) : (
        maxPain && (
          <span className="text-xs text-muted">
            Max pain only available for the nearest expiration ({maxPain.expirationDate})
          </span>
        )
      )}
    </div>
  );
}
