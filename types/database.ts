/**
 * Hand-written typing for the Supabase schema defined in
 * supabase/migrations/0001_init.sql and 0002_briefings.sql, shaped to
 * match what the Supabase CLI would generate (Tables/Views/Functions,
 * Relationships on each table) so it satisfies @supabase/postgrest-js's
 * GenericSchema constraint. Kept in sync manually until the schema
 * stabilizes enough to generate this.
 */

import type { BriefingContent, DirectionalLean } from "@/lib/briefing";
import type { HeadlineCategory, HeadlineLevel } from "@/lib/headline-classification";
import type { InsiderActivitySummary } from "@/lib/sec-edgar";

export type PositionType = "covered_call" | "cash_secured_put";

export type PositionStatus = "open" | "closed" | "assigned" | "expired";

export type WatchlistRow = {
  id: string;
  ticker: string;
  added_at: string;
};

export type PositionRow = {
  id: string;
  ticker: string;
  position_type: PositionType;
  shares_owned: number | null;
  cost_basis: number | null;
  strike: number;
  premium_collected: number;
  expiration_date: string;
  contracts: number;
  status: PositionStatus;
  opened_at: string;
  closed_at: string | null;
  /** Per-share price paid to buy back the option early, when closed (not assigned). */
  closing_premium: number | null;
  /** Realized net P/L (stock leg + option leg combined) at close/assignment -- see lib/position-analytics.ts. */
  realized_pl: number | null;
};

export type IvHistoryRow = {
  id: string;
  ticker: string;
  date: string;
  implied_volatility_avg: number | null;
  trailing_30d_hv: number | null;
};

export type BriefingRow = {
  id: string;
  ticker: string;
  content: BriefingContent;
  generated_at: string;
};

/**
 * Permanent, no-TTL cache: a headline's classification never changes once
 * published. `id` is a stable identifier (article URL, or a hash of
 * headline+date -- see lib/headline-classification-service.ts).
 */
export type HeadlineClassificationRow = {
  id: string;
  level: HeadlineLevel;
  category: HeadlineCategory;
  classified_at: string;
};

export type LeanOutcome = "held_up" | "reversed" | "unclear";

/**
 * One row per per-ticker briefing regeneration (not cache hits -- see
 * lib/briefing-service.ts's getOrGenerateBriefing), tracking whether the
 * briefing's directionalLean held up 10 real trading days later. Resolved
 * by app/api/lean-resolve's scheduled job; surfaced as an accuracy summary
 * on the Guidance page via app/api/lean-accuracy.
 */
export type LeanHistoryRow = {
  id: string;
  ticker: string;
  date: string;
  lean: DirectionalLean;
  price_at_snapshot: number;
  price_after_10_trading_days: number | null;
  outcome: LeanOutcome | null;
};

/**
 * Cached aggregated SEC EDGAR Form 4 summary per ticker -- same
 * upsert-by-ticker cache shape as BriefingRow, just a different content
 * payload. See lib/insider-service.ts.
 */
export type InsiderActivityRow = {
  id: string;
  ticker: string;
  content: InsiderActivitySummary;
  generated_at: string;
};

export interface Database {
  public: {
    Tables: {
      watchlist: {
        Row: WatchlistRow;
        Insert: Partial<Pick<WatchlistRow, "id" | "added_at">> &
          Pick<WatchlistRow, "ticker">;
        Update: Partial<WatchlistRow>;
        Relationships: [];
      };
      positions: {
        Row: PositionRow;
        Insert: Partial<
          Pick<
            PositionRow,
            | "id"
            | "shares_owned"
            | "cost_basis"
            | "status"
            | "opened_at"
            | "closed_at"
            | "closing_premium"
            | "realized_pl"
          >
        > &
          Pick<
            PositionRow,
            | "ticker"
            | "position_type"
            | "strike"
            | "premium_collected"
            | "expiration_date"
            | "contracts"
          >;
        Update: Partial<PositionRow>;
        Relationships: [];
      };
      iv_history: {
        Row: IvHistoryRow;
        Insert: Partial<
          Pick<
            IvHistoryRow,
            "id" | "implied_volatility_avg" | "trailing_30d_hv"
          >
        > &
          Pick<IvHistoryRow, "ticker" | "date">;
        Update: Partial<IvHistoryRow>;
        Relationships: [];
      };
      briefings: {
        Row: BriefingRow;
        Insert: Partial<Pick<BriefingRow, "id" | "generated_at">> &
          Pick<BriefingRow, "ticker" | "content">;
        Update: Partial<BriefingRow>;
        Relationships: [];
      };
      headline_classifications: {
        Row: HeadlineClassificationRow;
        Insert: Partial<Pick<HeadlineClassificationRow, "classified_at">> &
          Pick<HeadlineClassificationRow, "id" | "level" | "category">;
        Update: Partial<HeadlineClassificationRow>;
        Relationships: [];
      };
      lean_history: {
        Row: LeanHistoryRow;
        Insert: Partial<
          Pick<LeanHistoryRow, "id" | "price_after_10_trading_days" | "outcome">
        > &
          Pick<LeanHistoryRow, "ticker" | "date" | "lean" | "price_at_snapshot">;
        Update: Partial<LeanHistoryRow>;
        Relationships: [];
      };
      insider_activity: {
        Row: InsiderActivityRow;
        Insert: Partial<Pick<InsiderActivityRow, "id" | "generated_at">> &
          Pick<InsiderActivityRow, "ticker" | "content">;
        Update: Partial<InsiderActivityRow>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
  };
}
