import type { NewsHeadline } from "@/types/api";
import { formatRelativeTime } from "@/lib/format";

export function HeadlineList({ headlines }: { headlines: NewsHeadline[] }) {
  if (headlines.length === 0) {
    return <p className="text-sm text-muted">No recent articles found.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {headlines.map((item) => (
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
  );
}
