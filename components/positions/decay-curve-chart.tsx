import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DecayCurvePoint } from "@/types/api";
import { formatCurrency } from "@/lib/format";

export function DecayCurveChart({
  curve,
  currentDte,
}: {
  curve: DecayCurvePoint[];
  currentDte: number;
}) {
  if (curve.length === 0) {
    return <p className="text-xs text-muted">Decay curve unavailable.</p>;
  }

  // Curve is stored originalDte -> 0; recharts wants ascending x for a
  // left-to-right "time passing" read, so reverse for display only.
  const data = [...curve].reverse();
  const todayPoint = curve.find((p) => p.dte === currentDte) ?? curve[curve.length - 1];

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="dte"
            reversed
            stroke="var(--muted)"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            tickFormatter={(v) => `${v}d`}
          />
          <YAxis
            stroke="var(--muted)"
            tick={{ fontSize: 10, fill: "var(--muted)" }}
            tickFormatter={(v) => formatCurrency(v, 0)}
            width={44}
          />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11 }}
            formatter={(value) => formatCurrency(Number(value))}
            labelFormatter={(label) => `${label} DTE`}
          />
          <Line
            type="monotone"
            dataKey="theoreticalValue"
            stroke="var(--accent)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={todayPoint.dte}
            y={todayPoint.theoreticalValue}
            r={4}
            fill="var(--foreground)"
            stroke="none"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
