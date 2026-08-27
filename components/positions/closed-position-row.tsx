import type { PositionSummary } from "@/types/api";
import { formatCurrency, formatDate } from "@/lib/format";

export function ClosedPositionRow({ position }: { position: PositionSummary }) {
  const isCoveredCall = position.position_type === "covered_call";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-foreground">{position.ticker}</span>
        <span className="text-xs text-muted">
          {isCoveredCall ? "CC" : "CSP"} · {position.strike} strike ·{" "}
          {position.status === "assigned" ? "assigned" : "closed"} {formatDate(position.closed_at)}
        </span>
      </div>
      <span
        className={`font-mono text-sm font-medium ${
          (position.realized_pl ?? 0) >= 0 ? "text-accent" : "text-red-400"
        }`}
      >
        {position.realized_pl != null ? formatCurrency(position.realized_pl) : "—"}
      </span>
    </div>
  );
}
