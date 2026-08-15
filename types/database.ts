/**
 * Hand-written typing for the Supabase schema defined in
 * supabase/migrations/0001_init.sql. Kept in sync manually until the schema
 * stabilizes enough to generate this via the Supabase CLI.
 */

export type PositionType = "covered_call" | "cash_secured_put";

export type PositionStatus = "open" | "closed" | "assigned" | "expired";

export interface WatchlistRow {
  id: string;
  ticker: string;
  added_at: string;
}

export interface PositionRow {
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
}

export interface IvHistoryRow {
  id: string;
  ticker: string;
  date: string;
  implied_volatility_avg: number | null;
  trailing_30d_hv: number | null;
}

export interface Database {
  public: {
    Tables: {
      watchlist: {
        Row: WatchlistRow;
        Insert: Partial<Pick<WatchlistRow, "id" | "added_at">> &
          Pick<WatchlistRow, "ticker">;
        Update: Partial<WatchlistRow>;
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
      };
    };
  };
}
