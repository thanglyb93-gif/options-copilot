"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  RankingCallSideResult,
  RankingExpirationOption,
  RankingExpirationsResponse,
  RankingResponse,
  RankingSideResult,
  RankingTickerResult,
} from "@/types/api";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { tierClasses } from "@/components/shared/tier-classes";
import { ExpirationSelect } from "@/components/shared/expiration-select";

type SortMode = "max" | "put" | "call";

function scoreOf(t: RankingTickerResult, mode: "put" | "call"): number {
  const side = mode === "put" ? t.put : t.call;
  return side ? side.score : -Infinity;
}

function maxScore(t: RankingTickerResult): number {
  return Math.max(scoreOf(t, "put"), scoreOf(t, "call"));
}

function YourPositionBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      Your Position
    </span>
  );
}

function HypotheticalBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Hypothetical
    </span>
  );
}

function ScoreCell({ side, error }: { side: RankingSideResult | null; error: string | null }) {
  if (!side) {
    return <span className="text-xs text-muted">{error ?? "No valid contract found near target"}</span>;
  }
  const c = tierClasses(side.tier);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`font-mono text-lg font-semibold ${c.text}`}>{side.score.toFixed(1)}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${c.text} ${c.border}`}>{side.tier}</span>
      </div>
      <span className="text-[11px] text-muted">
        ${side.strike} strike, {side.dte}d (exp {formatDate(side.expirationDate)})
      </span>
    </div>
  );
}

/**
 * Phase 42 -- Ranking reads whatever briefing/lean is already cached and
 * never generates one itself, so the tradeoff (possibly stale, or
 * entirely absent) needs to be visible per row rather than hidden behind
 * a score that looks as authoritative as an individual ticker page's.
 */
function BriefingAge({ generatedAt }: { generatedAt: string | null }) {
  if (!generatedAt) {
    return <div className="text-[11px] text-amber-400">no briefing cached yet</div>;
  }
  return <div className="text-[11px] text-muted">lean: {formatRelativeTime(generatedAt)}</div>;
}

function CostBasisCell({
  ticker,
  call,
  value,
  onChange,
}: {
  ticker: string;
  call: RankingCallSideResult | null;
  value: string;
  onChange: (ticker: string, value: string) => void;
}) {
  if (!call) return <span className="text-xs text-muted">—</span>;

  if (call.costBasisMode === "your-position") {
    return (
      <div className="flex flex-col gap-1">
        <YourPositionBadge />
        <span className="font-mono text-xs text-foreground">{formatCurrency(call.costBasis)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <HypotheticalBadge />
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(ticker, e.target.value)}
        className="w-24 rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
      />
    </div>
  );
}

export function RankingDashboard() {
  // The dropdown's own selectable dates -- the union of expiration dates
  // across every watchlisted ticker's own chain (see
  // app/api/ranking/expirations/route.ts), since unlike the Strike
  // Selector this page has no single ticker's chain to source dates from.
  const [expirations, setExpirations] = useState<RankingExpirationOption[]>([]);
  const [expirationIndex, setExpirationIndex] = useState(0);
  const [callPctAbove, setCallPctAbove] = useState("10");
  const [putPctBelow, setPutPctBelow] = useState("10");
  const [costBasisInputs, setCostBasisInputs] = useState<Record<string, string>>({});
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("max");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ranking/expirations", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: RankingExpirationsResponse) => {
        if (cancelled) return;
        setExpirations(body.expirations ?? []);
        setExpirationIndex(body.defaultIndex ?? 0);
      })
      .catch(() => {
        // Leave the dropdown empty -- Calculate Rankings stays disabled below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function calculate() {
    const targetDte = expirations[expirationIndex]?.dte;
    if (targetDte == null) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ targetDte: String(targetDte), callPctAbove, putPctBelow });
      for (const [ticker, value] of Object.entries(costBasisInputs)) {
        if (value.trim() !== "") params.set(`costBasis_${ticker}`, value);
      }
      const res = await fetch(`/api/ranking?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't calculate rankings.");
        setData(null);
        return;
      }
      const result = body as RankingResponse;
      setData(result);
      setCostBasisInputs((prev) => {
        const next = { ...prev };
        for (const t of result.results) {
          if (t.call && t.call.costBasisMode === "hypothetical" && next[t.ticker] === undefined) {
            next[t.ticker] = t.call.costBasis != null ? String(t.call.costBasis) : "";
          }
        }
        return next;
      });
    } catch {
      setError("Couldn't calculate rankings.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const sorted = data
    ? [...data.results].sort((a, b) => {
        const av = sortMode === "max" ? maxScore(a) : scoreOf(a, sortMode);
        const bv = sortMode === "max" ? maxScore(b) : scoreOf(b, sortMode);
        return bv - av;
      })
    : [];

  return (
    <div className="flex flex-col gap-6 px-4 py-6 pb-20 lg:px-8 lg:pb-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">Ranking</h1>
        <p className="text-sm text-muted">
          Full weighted Entry Score for every watchlisted ticker at once, at a target strike distance and expiration
          -- compare opportunity across your whole watchlist before drilling into any one ticker.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-surface p-4">
        <ExpirationSelect expirations={expirations} index={expirationIndex} onChange={setExpirationIndex} />
        <label className="flex flex-col gap-1 text-xs text-muted">
          Call % Above Current Price
          <input
            type="number"
            min={0}
            step="0.5"
            value={callPctAbove}
            onChange={(e) => setCallPctAbove(e.target.value)}
            className="w-28 min-h-11 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground lg:min-h-0"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Put % Below Current Price
          <input
            type="number"
            min={0}
            step="0.5"
            value={putPctBelow}
            onChange={(e) => setPutPctBelow(e.target.value)}
            className="w-28 min-h-11 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground lg:min-h-0"
          />
        </label>
        <button
          type="button"
          onClick={calculate}
          disabled={loading || expirations.length === 0}
          className="min-h-11 rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50 lg:min-h-0"
        >
          {loading ? "Calculating…" : "Calculate Rankings"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {data && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            Sort by:
            {(["max", "put", "call"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSortMode(m)}
                className={`rounded px-2 py-1 ${sortMode === m ? "bg-accent/15 text-foreground" : "hover:text-foreground"}`}
              >
                {m === "max" ? "Best of Either" : m === "put" ? "Put Score" : "Call Score"}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Put Score</th>
                  <th className="px-3 py-2">Call Score</th>
                  <th className="px-3 py-2">Cost Basis (call)</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.ticker} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <Link href={`/ticker/${t.ticker}`} className="font-mono font-semibold text-foreground hover:text-accent">
                        {t.ticker}
                      </Link>
                      {t.currentPrice != null && (
                        <div className="text-[11px] text-muted">{formatCurrency(t.currentPrice)}</div>
                      )}
                      <BriefingAge generatedAt={t.briefingGeneratedAt} />
                    </td>
                    <td className="px-3 py-2">
                      <ScoreCell side={t.put} error={t.putError} />
                    </td>
                    <td className="px-3 py-2">
                      <ScoreCell side={t.call} error={t.callError} />
                    </td>
                    <td className="px-3 py-2">
                      <CostBasisCell
                        ticker={t.ticker}
                        call={t.call}
                        value={costBasisInputs[t.ticker] ?? ""}
                        onChange={(ticker, value) => setCostBasisInputs((prev) => ({ ...prev, [ticker]: value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">Set your targets above and click Calculate Rankings.</p>
        </div>
      )}
    </div>
  );
}
