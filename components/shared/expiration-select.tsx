import { formatMonthDay } from "@/lib/format";

export interface ExpirationSelectOption {
  expirationDate: string;
  dte: number;
}

/**
 * The DTE/Expiration dropdown -- shared so every caller gets the exact
 * same control, not a lookalike copy. Originally lived inline in
 * components/ticker/strike-selector.tsx (a single ticker's own chain);
 * extracted in Phase 41 so the Ranking page's cross-ticker union list
 * (see app/api/ranking/expirations/route.ts) renders through the
 * identical component. Selection is by index into `expirations`, since
 * callers keep their own list and just need "which one is picked."
 */
export function ExpirationSelect({
  expirations,
  index,
  onChange,
  label = "DTE / Expiration",
}: {
  expirations: readonly ExpirationSelectOption[];
  index: number;
  onChange: (index: number) => void;
  label?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={expirations.length === 0}
        className="w-full min-h-11 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50 sm:w-auto sm:min-h-0"
      >
        {expirations.map((exp, i) => (
          <option key={exp.expirationDate} value={i}>
            {exp.dte}d · {formatMonthDay(exp.expirationDate)}
          </option>
        ))}
      </select>
    </label>
  );
}
