"use client";

/**
 * Phase 37 -- Import Trade History. Uploads a Robinhood activity CSV,
 * shows a dry-run preview (parsed/matched/duplicate counts, with
 * specifics -- not just a summary number) before anything is written,
 * then re-sends the same file with commit=true only once the user
 * explicitly confirms. No server-side state between preview and commit.
 */

import { useRef, useState } from "react";
import type { CsvImportResponse } from "@/types/api";
import { formatCurrency, formatDate } from "@/lib/format";

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-lg font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function ImportCsvPanel({ onImported }: { onImported: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImportResponse | null>(null);
  const [committedResult, setCommittedResult] = useState<CsvImportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runImport(selectedFile: File, commit: boolean): Promise<CsvImportResponse | null> {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("commit", commit ? "true" : "false");
      const res = await fetch("/api/import-csv", { method: "POST", body: formData });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't process this file.");
        return null;
      }
      return body as CsvImportResponse;
    } catch {
      setError("Couldn't process this file.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setCommittedResult(null);
    setError(null);
    if (selected) {
      const result = await runImport(selected, false);
      setPreview(result);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    const result = await runImport(file, true);
    if (result) {
      setCommittedResult(result);
      setPreview(null);
      onImported();
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setCommittedResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-muted hover:text-foreground lg:min-h-0"
      >
        {expanded ? "▾" : "▸"} Import Trade History
      </button>

      {expanded && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Upload a Robinhood account activity CSV export to backfill closed/assigned/expired covered-call and
            cash-secured-put trades from before this app was tracking them. Only reflects what&rsquo;s actually in
            the export -- this can be run again as your export grows over time; already-logged trades are detected
            and skipped, never duplicated.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={loading}
            className="text-xs text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:text-foreground"
          />

          {loading && <p className="text-xs text-muted">Parsing…</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}

          {preview && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatChip label="Rows parsed" value={preview.totalRowsParsed} />
                <StatChip label="Round trips matched" value={preview.roundTripsMatched} />
                <StatChip label="Will import" value={preview.toInsert.length} />
                <StatChip label="Duplicates skipped" value={preview.duplicatesSkipped} />
              </div>

              {preview.skippedRows.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted">
                    {preview.skippedRows.length} row{preview.skippedRows.length === 1 ? "" : "s"} failed to parse
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1 pl-3 text-[11px] text-muted">
                    {preview.skippedRows.map((r) => (
                      <li key={r.rowNumber}>
                        Row {r.rowNumber}: {r.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {(preview.unmatchedOpens.length > 0 || preview.unmatchedCloses.length > 0) && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted">
                    {preview.unmatchedOpens.length + preview.unmatchedCloses.length} contract event
                    {preview.unmatchedOpens.length + preview.unmatchedCloses.length === 1 ? "" : "s"} had no matching
                    open/close in this export
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1 pl-3 text-[11px] text-muted">
                    {preview.unmatchedOpens.map((u) => (
                      <li key={`open-${u.rowNumber}`}>
                        Row {u.rowNumber} ({formatDate(u.activityDate)}): {u.unmatchedQuantity}x {u.description} --
                        no close found (likely still open in the brokerage).
                      </li>
                    ))}
                    {preview.unmatchedCloses.map((u) => (
                      <li key={`close-${u.rowNumber}`}>
                        Row {u.rowNumber} ({formatDate(u.activityDate)}): {u.unmatchedQuantity}x {u.transCode} --{" "}
                        {u.description} -- no open found (likely opened before this export&rsquo;s date range).
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.duplicates.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted">
                    {preview.duplicates.length} duplicate{preview.duplicates.length === 1 ? "" : "s"} (already logged)
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1 pl-3 text-[11px] text-muted">
                    {preview.duplicates.map((d, i) => (
                      <li key={i}>
                        {d.ticker} {d.strike} {d.positionType === "covered_call" ? "C" : "P"} opened{" "}
                        {formatDate(d.openedAt)}, exp {formatDate(d.expirationDate)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.toInsert.length > 0 ? (
                <>
                  <details className="text-xs" open={preview.toInsert.length <= 10}>
                    <summary className="cursor-pointer text-muted">
                      Preview: {preview.toInsert.length} position{preview.toInsert.length === 1 ? "" : "s"} to import
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="text-muted">
                            <th className="pr-3 pb-1">Ticker</th>
                            <th className="pr-3 pb-1">Strike</th>
                            <th className="pr-3 pb-1">Opened</th>
                            <th className="pr-3 pb-1">Closed</th>
                            <th className="pr-3 pb-1">Status</th>
                            <th className="pr-3 pb-1">Premium</th>
                            <th className="pb-1">Realized P/L</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-foreground">
                          {preview.toInsert.map((c, i) => (
                            <tr key={i}>
                              <td className="pr-3 py-0.5">
                                {c.ticker} {c.positionType === "covered_call" ? "C" : "P"}
                              </td>
                              <td className="pr-3 py-0.5">{c.strike}</td>
                              <td className="pr-3 py-0.5">{formatDate(c.openedAt)}</td>
                              <td className="pr-3 py-0.5">{formatDate(c.closedAt)}</td>
                              <td className="pr-3 py-0.5">{c.status}</td>
                              <td className="pr-3 py-0.5">{formatCurrency(c.premiumCollected)}</td>
                              <td className={`py-0.5 ${c.realizedPl >= 0 ? "text-accent" : "text-red-400"}`}>
                                {formatCurrency(c.realizedPl)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>

                  <div className="flex items-center gap-2 border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={loading}
                      className="min-h-11 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50 lg:min-h-0"
                    >
                      Confirm Import ({preview.toInsert.length})
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      className="min-h-11 px-2 text-xs text-muted hover:text-foreground lg:min-h-0"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted">
                  Nothing new to import -- every matched round trip in this file is already logged.
                </p>
              )}
            </div>
          )}

          {committedResult && (
            <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
              <span className="font-medium text-foreground">
                Imported {committedResult.insertedCount} position{committedResult.insertedCount === 1 ? "" : "s"}.
              </span>
              <button type="button" onClick={reset} className="w-fit text-xs text-muted hover:text-foreground">
                Import another file
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
