"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  annualizedReturn,
  cashSecuredPutBreakeven,
  cashSecuredPutPL,
  coveredCallBreakeven,
  coveredCallPL,
} from "@/lib/options-math";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { EntryScoreResponse } from "@/types/api";
import type { StrikeSelection } from "./strike-selector";

type PositionType = "covered_call" | "cash_secured_put";

function StatCard({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-foreground ${big ? "text-2xl font-semibold" : "text-base"}`}>
        {value}
      </span>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
      />
    </label>
  );
}

export function StrikeDecisionPanel({
  selection,
  currentPrice,
  putScore,
  callScore,
}: {
  selection: StrikeSelection | null;
  currentPrice: number | null;
  putScore: EntryScoreResponse | null;
  callScore: EntryScoreResponse | null;
}) {
  const [positionType, setPositionType] = useState<PositionType>("covered_call");
  const [price, setPrice] = useState<number>(0);
  const [strike, setStrike] = useState<number>(0);
  const [premiumPerShare, setPremiumPerShare] = useState<number>(0);
  const [dte, setDte] = useState<number>(0);
  const [shares, setShares] = useState<number>(100);
  const [costBasis, setCostBasis] = useState<number>(0);

  useEffect(() => {
    if (!selection) return;
    setPositionType(selection.positionType);
    setStrike(selection.strike);
    setPremiumPerShare(Number(selection.premium.toFixed(2)));
    setDte(selection.dte);
    const fallback = currentPrice ?? selection.strike;
    setPrice((prev) => prev || fallback);
    setCostBasis((prev) => prev || fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const totalPremium = premiumPerShare * shares;
  const capitalAtRisk =
    positionType === "covered_call" ? costBasis * shares : strike * shares;

  const maxProfit =
    positionType === "covered_call"
      ? coveredCallPL(strike, strike, costBasis, shares, totalPremium)
      : cashSecuredPutPL(strike, strike, totalPremium, shares);

  const breakeven =
    positionType === "covered_call"
      ? coveredCallBreakeven(costBasis, premiumPerShare)
      : cashSecuredPutBreakeven(strike, premiumPerShare);

  const returnIfOtm = capitalAtRisk > 0 ? (totalPremium / capitalAtRisk) * 100 : null;
  const annualized =
    capitalAtRisk > 0 && dte > 0
      ? annualizedReturn(totalPremium, capitalAtRisk, dte) * 100
      : null;

  const chartData = useMemo(() => {
    const center = price > 0 ? price : strike || 100;
    const points = 41;
    return Array.from({ length: points }, (_, i) => {
      const s = center * (0.75 + (i / (points - 1)) * 0.5);
      const pl =
        positionType === "covered_call"
          ? coveredCallPL(s, strike, costBasis, shares, totalPremium)
          : cashSecuredPutPL(s, strike, totalPremium, shares);
      return {
        price: Math.round(s * 100) / 100,
        pl: Math.round(pl * 100) / 100,
        plPositive: Math.max(pl, 0),
        plNegative: Math.min(pl, 0),
      };
    });
  }, [price, strike, costBasis, shares, totalPremium, positionType]);

  if (!selection) {
    return (
      <p className="text-sm text-muted">
        Select a DTE, strike, and direction above to see the full decision breakdown.
      </p>
    );
  }

  const tickerScore = selection.direction === "put" ? putScore : callScore;
  const opposesTradeDirection = tickerScore?.eventComponent.opposesTradeDirection ?? false;

  return (
    <div className="flex flex-col gap-4">
      {opposesTradeDirection && tickerScore && (
        <div className="rounded-md border border-red-500/60 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300">
          ⚠ Directional signal opposes this trade: {tickerScore.eventComponent.rationale}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-mono text-foreground">
          {selection.strike} {selection.direction === "put" ? "P" : "C"}
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          exp <span className="font-mono text-foreground">{selection.expirationDate}</span>
        </span>
        <span className="text-muted">
          (<span className="font-mono text-foreground">{selection.dte}</span> DTE)
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          premium <span className="font-mono text-foreground">{formatCurrency(selection.premium)}</span>
        </span>
        {selection.contract.usingLastPriceFallback && (
          <span
            className="text-xs text-muted"
            title="Market is closed -- no live bid/ask. Using the last traded price and greeks estimated from it."
          >
            (last price as of market close, not live)
          </span>
        )}
      </div>

      {/*
        Total entry score intentionally NOT shown here -- the Entry Score
        cards above are the single source of truth for that number (see
        entry-score-panel.tsx's combineWithStrikeCushion), so it can't
        disagree with what's shown there. This panel only surfaces detail
        specific to the selected contract.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Assignment Probability"
          value={selection.contract.assignmentProbability ?? "—"}
          big
        />
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">EM Cushion</span>
          <span className="font-mono text-2xl font-semibold text-foreground">
            {selection.contract.emCushion != null ? `${selection.contract.emCushion.toFixed(2)}x` : "—"}
          </span>
          <span className="text-xs text-muted">
            score {selection.contract.cushionScore != null ? formatNumber(selection.contract.cushionScore, 1) : "—"}
            {selection.contract.structuralConfirmation?.confirmed && (
              <span className="ml-1 text-accent">
                ✓ below/above {selection.contract.structuralConfirmation.referenceLabel}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["covered_call", "cash_secured_put"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setPositionType(type)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              positionType === type
                ? "border-accent bg-accent/10 text-foreground"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {type === "covered_call" ? "Covered Call" : "Cash-Secured Put"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NumberField label="Current Price" value={price} onChange={setPrice} step={0.01} />
        <NumberField label="Strike" value={strike} onChange={setStrike} step={0.5} />
        <NumberField
          label="Premium/Share"
          value={premiumPerShare}
          onChange={setPremiumPerShare}
          step={0.01}
        />
        <NumberField label="DTE" value={dte} onChange={setDte} />
        <NumberField label="Shares" value={shares} onChange={setShares} step={100} />
        {positionType === "covered_call" && (
          <NumberField label="Cost Basis" value={costBasis} onChange={setCostBasis} step={0.01} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Max Profit" value={formatCurrency(maxProfit)} />
        <StatCard label="Breakeven" value={formatCurrency(breakeven)} />
        <StatCard label="Return if OTM" value={formatPercent(returnIfOtm)} />
        <StatCard label="Annualized Return" value={formatPercent(annualized)} />
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="price"
              stroke="var(--muted)"
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              tickFormatter={(v) => formatCurrency(v, 0)}
            />
            <YAxis
              stroke="var(--muted)"
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              tickFormatter={(v) => formatCurrency(v, 0)}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
              formatter={(value) => formatCurrency(Number(value))}
              labelFormatter={(label) => `Price: ${formatCurrency(Number(label))}`}
            />
            <ReferenceLine y={0} stroke="var(--muted)" />
            <ReferenceLine
              x={breakeven}
              stroke="var(--foreground)"
              strokeDasharray="4 4"
              label={{ value: "BE", fill: "var(--muted)", fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="plPositive"
              stroke="none"
              fill="var(--accent)"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="plNegative"
              stroke="none"
              fill="#f87171"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="pl"
              stroke="var(--foreground)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
