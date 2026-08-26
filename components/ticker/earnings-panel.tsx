import type { EarningsResponse, NewsResponse } from "@/types/api";
import { formatDate, formatRelativeTime } from "@/lib/format";

export function EarningsPanel({
  earnings,
  news,
}: {
  earnings: EarningsResponse;
  news: NewsResponse | null;
}) {
  const cooldown = earnings.earningsCooldown;
  const earningsSoon =
    earnings.daysUntilEarnings != null && earnings.daysUntilEarnings <= 3;
  const showBanner = cooldown.flagged || earningsSoon;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-sm text-foreground">
          Next earnings:{" "}
          <span className="font-mono">{formatDate(earnings.nextEarningsDate)}</span>
        </span>
        {earnings.daysUntilEarnings != null && (
          <span className="font-mono text-sm text-muted">
            ({earnings.daysUntilEarnings}d away)
          </span>
        )}
      </div>

      {showBanner && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {cooldown.flagged && cooldown.percentMoveLast10TradingDays != null && (
            <p>
              Cooldown flagged: price moved{" "}
              {cooldown.percentMoveLast10TradingDays >= 0 ? "+" : ""}
              {cooldown.percentMoveLast10TradingDays.toFixed(1)}% over the last 10 trading days.
            </p>
          )}
          {earningsSoon && <p>Earnings in {earnings.daysUntilEarnings} day(s) — elevated event risk.</p>}
        </div>
      )}

      {news && news.headlines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {news.headlines.slice(0, 5).map((item) => (
            <li key={item.url} className="text-sm">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                {item.headline}
              </a>
              <span className="ml-2 text-xs text-muted">
                {item.source} · {formatRelativeTime(item.publishedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
