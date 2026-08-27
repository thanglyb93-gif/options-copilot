/**
 * Hand-written typing for the Supabase schema defined in
 * supabase/migrations/0001_init.sql and 0002_briefings.sql, shaped to
 * match what the Supabase CLI would generate (Tables/Views/Functions,
 * Relationships on each table) so it satisfies @supabase/postgrest-js's
 * GenericSchema constraint. Kept in sync manually until the schema
 * stabilizes enough to generate this.
 */

import type { BriefingContent } from "@/lib/briefing";

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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
  };
}
