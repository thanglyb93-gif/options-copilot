/**
 * Best-effort email alerting via Resend. This is a side-effect of routes
 * like /api/iv-snapshot (a Vercel Cron target with a tight timeout on the
 * Hobby plan), so every function here swallows its own errors and races
 * against a short timeout instead of letting a slow or broken email
 * provider block or fail the request that triggered it.
 */

import { Resend } from "resend";

const SEND_TIMEOUT_MS = 4000;

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Email send timed out after ${ms}ms`)), ms);
  });
}

export interface IvSnapshotFailure {
  ticker: string;
  status: "skipped" | "error";
  error?: string;
}

/**
 * Sends a short alert email summarizing which tickers failed in today's
 * IV snapshot run. Best-effort: any failure here (missing config, Resend
 * API error, timeout) is logged and swallowed, never thrown -- callers
 * should await this without wrapping it in their own try/catch.
 */
export async function sendIvSnapshotFailureAlert(
  date: string,
  failures: IvSnapshotFailure[]
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;

  if (!apiKey || !to || failures.length === 0) return;

  try {
    const resend = new Resend(apiKey);
    const lines = failures.map((f) => `- ${f.ticker}: ${f.status}${f.error ? ` (${f.error})` : ""}`);
    const count = failures.length;

    await Promise.race([
      resend.emails.send({
        from: "options-copilot <onboarding@resend.dev>",
        to,
        subject: `options-copilot: IV snapshot issues on ${date} (${count} ticker${count === 1 ? "" : "s"})`,
        text: [
          `The daily IV snapshot run on ${date} had issues for ${count} ticker(s):`,
          "",
          ...lines,
          "",
          "Check the Dashboard's health banner or /api/iv-snapshot for more detail.",
        ].join("\n"),
      }),
      timeout(SEND_TIMEOUT_MS),
    ]);
  } catch (error) {
    console.error(
      "Failed to send IV snapshot failure alert email:",
      error instanceof Error ? error.message : error
    );
  }
}
