import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProfitHistoryResult, ProfitTrajectoryTodayMarker } from "@/types/api";
import { formatCurrency } from "@/lib/format";

interface ChartRow {
  day: number;
  real?: number;
  projected?: number;
}

function mergeSeries(history: ProfitHistoryResult): ChartRow[] {
  const byDay = new Map<number, ChartRow>();
  for (const p of history.real) {
    byDay.set(p.day, { day: p.day, real: p.profitDollars });
  }
  for (const p of history.projected) {
    const existing = byDay.get(p.day);
    if (existing) existing.projected = p.profitDollars;
    else byDay.set(p.day, { day: p.day, projected: p.profitDollars });
  }
  return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
}

/**
 * Auto domain padded by the larger of 10% of the actual span or a flat
 * $5 -- without this floor, a near-flat trajectory (a common case for a
 * fresh or barely-moved position) collapses to a near-zero-height
 * range, which is what caused every Y-axis tick to render the same
 * rounded dollar label (a real bug, not a data issue: the underlying
 * values did differ, just not enough at 0-decimal precision to look
 * different once Recharts' auto ticks landed within a few dollars of
 * each other).
 */
function computeYDomain(values: number[]): [number, number] {
  if (values.length === 0) return [-1, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const padding = Math.max(span * 0.1, 5);
  return [min - padding, max + padding];
}

/** More decimal precision for a narrow range, so nearby tick values stay visually distinct instead of all rounding to the same label. */
function formatYTick(value: number, domainSpan: number): string {
  if (domainSpan < 20) return formatCurrency(value, 2);
  if (domainSpan < 200) return formatCurrency(value, 1);
  return formatCurrency(value, 0);
}

export function ProfitHistoryChart({
  history,
  todayMarker,
  maxProfit,
  closeTargetDollars,
}: {
  history: ProfitHistoryResult;
  todayMarker: ProfitTrajectoryTodayMarker | null;
  maxProfit: number | null;
  closeTargetDollars: number | null;
}) {
  if (history.real.length === 0 && history.projected.length === 0) {
    return <p className="text-xs text-muted">Profit history unavailable.</p>;
  }

  const data = mergeSeries(history);
  const totalDte = data[data.length - 1].day;

  const allValues = [
    ...history.real.map((p) => p.profitDollars),
    ...history.projected.map((p) => p.profitDollars),
    ...(maxProfit != null ? [maxProfit] : []),
    ...(closeTargetDollars != null ? [closeTargetDollars] : []),
  ];
  const [yMin, yMax] = computeYDomain(allValues);
  const ySpan = yMax - yMin;

  return (
    <div className="flex flex-col gap-2">
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              stroke="var(--muted)"
              tick={{ fontSize: 10, fill: "var(--muted)" }}
              tickFormatter={(v) => `Day ${v}`}
            />
            <YAxis
              stroke="var(--muted)"
              tick={{ fontSize: 10, fill: "var(--muted)" }}
              tickFormatter={(v) => formatYTick(v, ySpan)}
              width={64}
              domain={[yMin, yMax]}
            />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11 }}
              formatter={(value, name) => [
                formatCurrency(Number(value)),
                name === "real" ? "Actual" : "Projected (assumes price holds)",
              ]}
              labelFormatter={(label) => `Day ${label}`}
            />
            <ReferenceLine y={0} stroke="var(--muted)" />
            {maxProfit != null && (
              <ReferenceLine
                y={maxProfit}
                stroke="var(--foreground)"
                strokeDasharray="4 4"
                label={{ value: "100% target", position: "insideTopRight", fill: "var(--muted)", fontSize: 10 }}
              />
            )}
            {closeTargetDollars != null && (
              <ReferenceLine
                y={closeTargetDollars}
                stroke="var(--muted)"
                strokeDasharray="2 3"
                label={{ value: "close target", position: "insideBottomRight", fill: "var(--muted)", fontSize: 10 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="real"
              stroke="var(--accent)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke="var(--muted)"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            {todayMarker && (
              <ReferenceDot
                x={Math.min(todayMarker.day, totalDte)}
                y={todayMarker.profitDollars}
                r={4}
                fill="var(--foreground)"
                stroke="none"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
          Actual
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-0.5 border-b border-dashed border-muted" />
          Projected (assumes price holds)
        </span>
        {todayMarker && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            Today ({formatCurrency(todayMarker.profitDollars)})
          </span>
        )}
      </div>
    </div>
  );
}
