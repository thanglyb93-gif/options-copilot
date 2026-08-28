/**
 * Cache-or-classify orchestration for headline classification: checks the
 * `headline_classifications` table for ids already classified, sends only
 * the unclassified remainder to Claude (batched per
 * HEADLINE_CLASSIFICATION_BATCH_SIZE), and upserts the results. A
 * headline's classification never changes once published, so this never
 * re-classifies an id already in the table -- unlike the briefings cache,
 * there's no TTL here at all.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  classifyHeadlines,
  HEADLINE_CLASSIFICATION_BATCH_SIZE,
  type ClassifiableHeadline,
  type HeadlineClassification,
} from "./headline-classification";

/**
 * A stable, deterministic id for a headline: the article URL when present
 * (already unique per article), otherwise a hash of headline text + publish
 * date (covers the rare case of a feed item with no url).
 */
export function stableHeadlineId(headline: { url?: string; headline: string; publishedAt: string }): string {
  if (headline.url && headline.url.trim()) return headline.url.trim();
  return createHash("sha1")
    .update(`${headline.headline}|${headline.publishedAt.slice(0, 10)}`)
    .digest("hex");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Returns a classification for every headline in `headlines`, reading
 * already-classified ids from cache and classifying only the rest
 * (sequentially, one Anthropic call per batch of up to
 * HEADLINE_CLASSIFICATION_BATCH_SIZE, to keep cost bounded and requests
 * gentle on rate limits). Newly classified rows are upserted permanently
 * -- once a headline is classified, it's never re-sent to Claude again.
 */
export async function getOrClassifyHeadlines(
  supabase: SupabaseClient<Database>,
  headlines: ClassifiableHeadline[]
): Promise<Map<string, HeadlineClassification>> {
  const byId = new Map(headlines.map((h) => [h.id, h]));
  const ids = Array.from(byId.keys());
  const result = new Map<string, HeadlineClassification>();
  if (ids.length === 0) return result;

  const { data: cachedRows, error: readError } = await supabase
    .from("headline_classifications")
    .select("id, level, category")
    .in("id", ids);

  if (readError) {
    console.error("Failed to read headline classification cache:", readError.message);
  }

  for (const row of cachedRows ?? []) {
    result.set(row.id, { level: row.level, category: row.category });
  }

  const uncached = ids.filter((id) => !result.has(id)).map((id) => byId.get(id)!);
  if (uncached.length === 0) return result;

  for (const batch of chunk(uncached, HEADLINE_CLASSIFICATION_BATCH_SIZE)) {
    const classified = await classifyHeadlines(batch);
    const rows: Database["public"]["Tables"]["headline_classifications"]["Insert"][] = [];

    for (const h of batch) {
      const c = classified.get(h.id);
      if (!c) continue; // dropped by validation -- will simply be re-attempted next load
      result.set(h.id, c);
      rows.push({ id: h.id, level: c.level, category: c.category });
    }

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("headline_classifications")
        .upsert(rows, { onConflict: "id" });
      if (upsertError) {
        console.error("Failed to cache headline classifications:", upsertError.message);
      }
    }
  }

  return result;
}
