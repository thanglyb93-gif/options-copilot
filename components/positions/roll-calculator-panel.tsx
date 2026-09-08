"use client";

/**
 * Phase 35 -- Roll Calculator. A third option alongside the existing
 * Hold/Close recommendation and Assignment Opportunity Cost panel, never
 * a replacement for either: what would rolling this position to a new
 * strike/expiration actually cost or pay, and how much more room does
 * the new strike buy? Same DTE/Strike dropdown pattern as the ticker
 * page's Strike Selector (comparison-panel.tsx's mini-selectors) --
 * reads the live chain already served by the existing /api/options
 * route, no new chain-fetching logic on the client.
 */

import { useEffect, useMemo, useState } from "react";
import type { OptionsResponse, RollPreviewResponse } from "@/types/api";
import { useJsonFetch } from "@/lib/use-json-fetch";
import { formatCurrency, formatMonthDay } from "@/lib/format";
import { guidanceIndicatorById } from "@/lib/guidance-content";
import { ImportanceBadge } from "@/components/shared/importance-badge";
import { SkeletonLines, ErrorNote } from "@/components/ticker/section";

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export function RollCalculatorPanel({
  positionId,
  ticker,
  positionType,
  currentStrike,
  currentExpirationDate,
}: {
  positionId: string;
  ticker: string;
  positionType: "covered_call" | "cash_secured_put";
  currentStrike: number;
  currentExpirationDate: string;
}) {
  const options = useJsonFetch<OptionsResponse>(`/api/options/${ticker}`);
  const direction = positionType === "covered_call" ? "call" : "put";
  const indicator = guidanceIndicatorById("roll-calculator");

  const [expirationIndex, setExpirationIndex] = useState<number | null>(null);
  const [strike, setStrike] = useState<number | null>(null);

  const expiration = options.data && expirationIndex != null ? options.data.expirations[expirationIndex] : undefined;

  const strikes = useMemo(() => {
    if (!expiration) return [];
    const list = direction === "call" ? expiration.calls : expiration.puts;
    return list.map((c) => c.strike).sort((a, b) => a - b);
  }, [expiration, direction]);

  // Default to a later expiration than the current one (a genuine "roll
  // out"), falling back to the furthest available -- and a strike
  // further from the current one in the safer direction (a genuine
  // "roll up/down"), falling back to closest-to-spot, same pattern the
  // ticker page's mini-selectors use.
  useEffect(() => {
    if (!options.data || expirationIndex != null) return;
    const laterIndex = options.data.expirations.findIndex((e) => e.expirationDate > currentExpirationDate);
    setExpirationIndex(laterIndex >= 0 ? laterIndex : options.data.expirations.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data]);

  useEffect(() => {
    if (strikes.length === 0) {
      setStrike(null);
      return;
    }
    if (strike != null && strikes.includes(strike)) return;

    const safer = direction === "call" ? strikes.filter((s) => s > currentStrike) : strikes.filter((s) => s < currentStrike);
    if (safer.length > 0) {
      setStrike(direction === "call" ? Math.min(...safer) : Math.max(...safer));
    } else {
      setStrike(strikes[Math.floor(strikes.length / 2)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strikes]);

  const previewUrl =
    expiration && strike != null
      ? `/api/roll-preview/${positionId}?newStrike=${strike}&newExpiration=${expiration.expirationDate}`
      : null;
  const preview = useJsonFetch<RollPreviewResponse>(previewUrl);

  if (options.loading && !options.data) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
        <span className="text-[11px] uppercase tracking-wide text-muted">Roll This Position</span>
        <SkeletonLines count={2} />
      </div>
    );
  }
  if (options.error) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
        <span className="text-[11px] uppercase tracking-wide text-muted">Roll This Position</span>
        <ErrorNote message={options.error} />
      </div>
    );
  }
  if (!options.data || options.data.expirations.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        Roll This Position
        {indicator && <ImportanceBadge tier={indicator.importanceTier} />}
      </span>
      <p className="text-xs text-muted">
        A third option alongside Hold/Close above -- roll this contract to a new strike and/or expiration instead of
        buying it back outright. Presented as numbers to weigh, not a recommendation.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          New DTE / Expiration
          <select
            value={expirationIndex ?? ""}
            onChange={(e) => setExpirationIndex(Number(e.target.value))}
            className="min-h-11 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground lg:min-h-0"
          >
            {options.data.expirations.map((exp, i) => (
              <option key={exp.expirationDate} value={i}>
                {exp.dte}d · {formatMonthDay(exp.expirationDate)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          New Strike
          <select
            value={strike ?? ""}
            onChange={(e) => setStrike(Number(e.target.value))}
            disabled={strikes.length === 0}
            className="min-h-11 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-50 lg:min-h-0"
          >
            {strikes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {preview.loading && <SkeletonLines count={3} />}
      {preview.error && <ErrorNote message={preview.error} />}

      {preview.data && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">Close current leg now</span>
              {preview.data.costToCloseCurrent != null ? (
                <>
                  <StatLine label="Buyback cost (per share)" value={formatCurrency(preview.data.costToCloseCurrent)} />
                  <StatLine
                    label="Realized P/L (total)"
                    value={formatCurrency(preview.data.realizedLossOnCurrentLeg)}
                  />
                  {preview.data.currentUsingLastPriceFallback && (
                    <span className="text-[10px] text-muted">last price as of market close, not live</span>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted">No reliable market for the current contract right now.</span>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                Roll to {preview.data.newStrike} {direction === "call" ? "C" : "P"} · {formatMonthDay(preview.data.newExpiration)}
              </span>
              {preview.data.creditFromNewContract != null ? (
                <StatLine label="Credit from new contract (per share)" value={formatCurrency(preview.data.creditFromNewContract)} />
              ) : (
                <span className="text-sm text-muted">No reliable market for this contract.</span>
              )}
              {preview.data.newPositionMetrics?.usingLastPriceFallback && (
                <span className="text-[10px] text-muted">last price as of market close, not live</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-0.5 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-muted">
              Net roll {preview.data.netRollCreditOrDebit != null && preview.data.netRollCreditOrDebit >= 0 ? "credit" : "debit"} (total)
            </span>
            <span className="font-mono text-xl font-semibold text-foreground">
              {preview.data.netRollCreditOrDebit != null ? formatCurrency(preview.data.netRollCreditOrDebit) : "—"}
            </span>
            <span className="text-xs text-muted">
              Credit from the new contract minus the cost to close the current one -- positive means you&rsquo;re paid to
              roll, negative means rolling costs money up front, in exchange for the new strike&rsquo;s cushion below.
            </span>
          </div>

          {preview.data.newPositionMetrics && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">New position, if rolled</span>
              <StatLine
                label="EM Cushion"
                value={
                  preview.data.newPositionMetrics.emCushion != null
                    ? `${preview.data.newPositionMetrics.emCushion.toFixed(2)}x expected move (score ${preview.data.newPositionMetrics.cushionScore?.toFixed(1) ?? "—"})`
                    : "—"
                }
              />
              <StatLine
                label="Structural confirmation"
                value={
                  preview.data.newPositionMetrics.structuralConfirmation
                    ? preview.data.newPositionMetrics.structuralConfirmation.confirmed
                      ? `✓ ${direction === "put" ? "below" : "above"} ${preview.data.newPositionMetrics.structuralConfirmation.referenceLabel}`
                      : `not confirmed (${preview.data.newPositionMetrics.structuralConfirmation.referenceLabel})`
                    : "—"
                }
              />
              <StatLine
                label="Assignment probability"
                value={preview.data.newPositionMetrics.assignmentProbability ?? "—"}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
