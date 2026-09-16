import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase";
import { alertCategoryLabel, checkForAlertableNews, isWithinMarketHours } from "@/lib/position-alerts";
import { sendPositionAlertEmail } from "@/lib/alerts";
import type { PositionAlertCheckResult } from "@/types/api";

/**
 * Vercel Cron target (see vercel.json) -- polls every ticker with an
 * open position for alertable news since the last alert sent for that
 * ticker (alert_log's own MAX(sent_at) doubles as the watermark, no
 * separate settings table). Skips entirely outside roughly-market-hours
 * unless `?force=true` is passed, for manual/testing invocation. Can
 * chain a Finnhub fetch + classification call per distinct ticker, so
 * gets the same maxDuration treatment as this app's other multi-fetch
 * routes.
 */
export const maxDuration = 60;

/** First-ever check for a ticker (no alert_log history yet) looks back this far rather than its entire news history. */
const DEFAULT_LOOKBACK_MINUTES = 60;

function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  const now = new Date();
  const withinMarketHours = isWithinMarketHours(now);

  if (!withinMarketHours && !force) {
    return NextResponse.json({
      ranAt: now.toISOString(),
      withinMarketHours: false,
      forced: false,
      skipped: true,
      results: [],
      totalAlertsSent: 0,
    });
  }

  const supabase = getSupabaseRouteClient();

  const { data: openPositions, error: positionsError } = await supabase
    .from("positions")
    .select("ticker")
    .eq("status", "open");

  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 502 });
  }

  const tickers = Array.from(new Set((openPositions ?? []).map((p) => p.ticker)));

  if (tickers.length === 0) {
    return NextResponse.json({
      ranAt: now.toISOString(),
      withinMarketHours,
      forced: force,
      skipped: false,
      results: [],
      totalAlertsSent: 0,
    });
  }

  const { data: allAlertRows, error: alertLogError } = await supabase
    .from("alert_log")
    .select("ticker, headline_hash, sent_at");

  if (alertLogError) {
    return NextResponse.json({ error: alertLogError.message }, { status: 502 });
  }

  const lastSentAtByTicker = new Map<string, string>();
  const alreadySentByTicker = new Map<string, Set<string>>();
  for (const row of allAlertRows ?? []) {
    const currentMax = lastSentAtByTicker.get(row.ticker);
    if (!currentMax || row.sent_at > currentMax) lastSentAtByTicker.set(row.ticker, row.sent_at);
    const set = alreadySentByTicker.get(row.ticker) ?? new Set<string>();
    set.add(row.headline_hash);
    alreadySentByTicker.set(row.ticker, set);
  }

  const baseUrl = appBaseUrl();
  const results: PositionAlertCheckResult[] = [];
  let totalAlertsSent = 0;

  for (const ticker of tickers) {
    const sinceTimestamp =
      lastSentAtByTicker.get(ticker) ?? new Date(now.getTime() - DEFAULT_LOOKBACK_MINUTES * 60 * 1000).toISOString();

    try {
      const matches = await checkForAlertableNews(supabase, ticker, sinceTimestamp);
      const alreadySent = alreadySentByTicker.get(ticker) ?? new Set<string>();
      const genuinelyNew = matches.filter((m) => !alreadySent.has(m.headlineId));

      let alertsSent = 0;
      for (const match of genuinelyNew) {
        const emailResult = await sendPositionAlertEmail({
          ticker,
          headline: match.headline,
          source: match.source,
          categoryLabel: alertCategoryLabel(match.category),
          publishedAt: match.publishedAt,
          tickerUrl: `${baseUrl}/ticker/${ticker}`,
        });

        if (emailResult.sent) {
          const { error: insertError } = await supabase
            .from("alert_log")
            .insert({ ticker, headline_hash: match.headlineId });
          // A unique-violation here means a concurrent run already logged
          // this exact alert (rare, given the 15-30min poll interval) --
          // the email still genuinely went out, so it's still counted below.
          if (insertError && insertError.code !== "23505") {
            console.error(`Failed to record sent alert for ${ticker}:`, insertError.message);
          }
          alertsSent++;
          totalAlertsSent++;
        } else {
          console.error(`Failed to send position alert for ${ticker}:`, emailResult.error);
        }
      }

      results.push({
        ticker,
        matchesFound: matches.length,
        alertsSent,
        duplicatesSkipped: matches.length - genuinelyNew.length,
      });
    } catch (error) {
      results.push({
        ticker,
        matchesFound: 0,
        alertsSent: 0,
        duplicatesSkipped: 0,
        error: error instanceof Error ? error.message : "Failed to check news for this ticker.",
      });
    }
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    withinMarketHours,
    forced: force,
    skipped: false,
    results,
    totalAlertsSent,
  });
}
