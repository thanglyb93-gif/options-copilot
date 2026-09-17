"use client";

import { useMemo, useState } from "react";
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
import type { EventAnnotation, EventTimelineResponse, EventTimelineWindow } from "@/types/api";
import { useJsonFetch } from "@/lib/use-json-fetch";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { CATEGORY_LABELS } from "@/components/news/headline-groups";
import { SkeletonLines, ErrorNote } from "./section";

const WINDOWS: { value: EventTimelineWindow; label: string }[] = [
  { value: "1w", label: "1W" },
  { value: "1mo", label: "1M" },
  { value: "3mo", label: "3M" },
  { value: "1yr", label: "1Y" },
  { value: "3yr", label: "3Y" },
];

const MOVE_UP_COLOR = "var(--accent)";
const MOVE_DOWN_COLOR = "#f87171";
const EARNINGS_COLOR = "#facc15";
const MACRO_COLOR = "#38bdf8";

function markerColor(a: EventAnnotation): string {
  if (a.type === "earnings") return EARNINGS_COLOR;
  if (a.type === "macro") return MACRO_COLOR;
  return a.pctChange != null && a.pctChange >= 0 ? MOVE_UP_COLOR : MOVE_DOWN_COLOR;
}

function typeLabel(a: EventAnnotation): string {
  if (a.type === "earnings") return "Earnings";
  if (a.type === "macro") return "Sector Context";
  return "Large Move";
}

/** The row's stored classification (lib/event-timeline.ts's findCatalystNearDate -- a real HeadlineCategory value, e.g. "financing-event") mapped to the same friendly label the News page uses. Falls back to the raw string for a value that predates a category being added, rather than hiding it. */
function categoryLabel(classification: string | null): string | null {
  if (!classification) return null;
  return (CATEGORY_LABELS as Record<string, string>)[classification] ?? classification;
}

/** A single annotation positioned onto the nearest actual chart data point -- annotation dates (esp. earnings) don't always land on a trading day present in the series. */
interface PlottedAnnotation {
  annotation: EventAnnotation;
  plotDate: string;
  plotClose: number;
}

function nearestSeriesPoint(
  series: { date: string; close: number }[],
  targetDate: string
): { date: string; close: number } | null {
  if (series.length === 0) return null;
  let best = series[0];
  let bestDiff = Math.abs(new Date(series[0].date).getTime() - new Date(targetDate).getTime());
  for (const point of series) {
    const diff = Math.abs(new Date(point.date).getTime() - new Date(targetDate).getTime());
    if (diff < bestDiff) {
      best = point;
      bestDiff = diff;
    }
  }
  return best;
}

function Legend() {
  const items = [
    { color: MOVE_UP_COLOR, label: "Large move (up)" },
    { color: MOVE_DOWN_COLOR, label: "Large move (down)" },
    { color: EARNINGS_COLOR, label: "Earnings" },
    { color: MACRO_COLOR, label: "Sector context" },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function AnnotationDetail({ annotation }: { annotation: EventAnnotation }) {
  const category = categoryLabel(annotation.classification);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-foreground">{formatDate(annotation.date)}</span>
        <span
          className="w-fit rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{ borderColor: markerColor(annotation), color: markerColor(annotation) }}
        >
          {typeLabel(annotation)}
        </span>
      </div>
      {annotation.pctChange != null && (
        <span
          className={`font-mono text-base font-semibold ${annotation.pctChange >= 0 ? "text-accent" : "text-red-400"}`}
        >
          {formatPercent(annotation.pctChange)}
        </span>
      )}
      {annotation.headline ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs leading-relaxed text-foreground">
            {annotation.headline} <span className="text-muted">({annotation.source})</span>
          </p>
          {category && (
            <span className="w-fit rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              {category}
            </span>
          )}
        </div>
      ) : annotation.type === "large-move" ? (
        <p className="text-xs text-muted">No specific catalyst found in available news.</p>
      ) : null}
    </div>
  );
}

export function EventTimelinePanel({ ticker }: { ticker: string }) {
  const [window, setWindow] = useState<EventTimelineWindow>("3mo");
  const [includeMacro, setIncludeMacro] = useState(false);
  const [selected, setSelected] = useState<EventAnnotation | null>(null);

  const { data, loading, error } = useJsonFetch<EventTimelineResponse>(
    `/api/event-timeline/${ticker}?window=${window}&includeMacro=${includeMacro}`
  );

  const plotted: PlottedAnnotation[] = useMemo(() => {
    if (!data) return [];
    return data.annotations
      .map((annotation) => {
        const point = nearestSeriesPoint(data.series, annotation.date);
        return point ? { annotation, plotDate: point.date, plotClose: point.close } : null;
      })
      .filter((p): p is PlottedAnnotation => p != null);
  }, [data]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit gap-1 rounded-md border border-border p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => {
                setWindow(w.value);
                setSelected(null);
              }}
              className={`min-h-11 rounded px-2.5 py-1 text-xs lg:min-h-0 ${
                window === w.value ? "bg-accent/15 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <label className="flex min-h-11 items-center gap-2 text-xs text-muted lg:min-h-0">
          <input
            type="checkbox"
            checked={includeMacro}
            onChange={(e) => {
              setIncludeMacro(e.target.checked);
              setSelected(null);
            }}
            className="h-4 w-4"
          />
          Show macro/sector context
        </label>
      </div>

      {loading && <SkeletonLines count={3} />}
      {error && <ErrorNote message={error} />}

      {data && data.series.length > 0 && (
        <>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="var(--muted)"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickFormatter={(v) => formatDate(v)}
                  minTickGap={40}
                />
                <YAxis
                  stroke="var(--muted)"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickFormatter={(v) => formatCurrency(v, 0)}
                  width={56}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11 }}
                  formatter={(value) => [formatCurrency(Number(value)), "Close"]}
                  labelFormatter={(label) => formatDate(String(label))}
                />
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="var(--foreground)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                {plotted.map((p, i) => (
                  <ReferenceDot
                    key={`${p.annotation.type}-${p.annotation.date}-${i}`}
                    x={p.plotDate}
                    y={p.plotClose}
                    r={5}
                    fill={markerColor(p.annotation)}
                    stroke="var(--surface)"
                    strokeWidth={1.5}
                    onClick={() => setSelected(p.annotation)}
                    style={{ cursor: "pointer" }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <Legend />

          {selected ? (
            <AnnotationDetail annotation={selected} />
          ) : (
            <p className="text-xs text-muted">
              {plotted.length > 0
                ? "Tap a marker on the chart to see what coincided with it."
                : `No earnings dates or moves of ${window === "1w" || window === "1mo" ? "5%+ in a day" : "8%+ over a few days"} found in this window.`}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-muted">
            Shows what coincided with past price moves — not a prediction of future movement.
          </p>
        </>
      )}

      {data && data.series.length === 0 && (
        <p className="text-sm text-muted">Not enough price history for {ticker} to show a timeline.</p>
      )}
    </div>
  );
}
