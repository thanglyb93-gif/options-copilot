"use client";

/**
 * Phase 39 -- confirmation list, mostly so the user can see the polling
 * cron is actually running: reuses alert_log directly (no new data
 * source), read via GET /api/alert-log. Not a settings/config UI --
 * there's nothing to toggle here, since the alert categories and market-
 * hours window are fixed, documented defaults (lib/position-alerts.ts).
 */

import { useState } from "react";
import type { AlertLogResponse } from "@/types/api";
import { useJsonFetch } from "@/lib/use-json-fetch";
import { formatRelativeTime } from "@/lib/format";
import { SkeletonLines, ErrorNote } from "@/components/ticker/section";

export function RecentAlertsPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data, loading, error } = useJsonFetch<AlertLogResponse>(expanded ? "/api/alert-log" : null);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-muted hover:text-foreground lg:min-h-0"
      >
        {expanded ? "▾" : "▸"} Alerts
      </button>

      {expanded && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            Position news alerts (M&amp;A/buyback, partnership, analyst action, earnings, executive change) are
            checked automatically every 15-30 minutes during market hours for every currently open position, and
            emailed once per headline. This list is just confirmation the check is actually running -- there&rsquo;s
            nothing to configure here.
          </p>

          {loading && <SkeletonLines count={2} />}
          {error && <ErrorNote message={error} />}

          {data && data.alerts.length === 0 && (
            <p className="text-sm text-muted">No alerts sent yet.</p>
          )}

          {data && data.alerts.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-2 border-t border-border pt-1.5 first:border-t-0 first:pt-0">
                  <span className="font-mono text-foreground">{a.ticker}</span>
                  <span className="text-xs text-muted">{formatRelativeTime(a.sentAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
