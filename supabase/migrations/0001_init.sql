-- options-copilot: Phase 1 foundation schema
-- Scope: covered calls and cash-secured puts only. Do not extend
-- position_type beyond these two values without a deliberate schema change.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- watchlist
-- ---------------------------------------------------------------------------
create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  added_at timestamptz not null default now()
);

create unique index if not exists watchlist_ticker_key on watchlist (upper(ticker));

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------
create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  position_type text not null check (position_type in ('covered_call', 'cash_secured_put')),
  shares_owned numeric,
  cost_basis numeric,
  strike numeric not null,
  premium_collected numeric not null,
  expiration_date date not null,
  contracts integer not null check (contracts > 0),
  status text not null default 'open' check (status in ('open', 'closed', 'assigned', 'expired')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists positions_ticker_idx on positions (ticker);
create index if not exists positions_status_idx on positions (status);

-- ---------------------------------------------------------------------------
-- iv_history
-- ---------------------------------------------------------------------------
create table if not exists iv_history (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  date date not null,
  implied_volatility_avg numeric,
  trailing_30d_hv numeric,
  unique (ticker, date)
);

create index if not exists iv_history_ticker_idx on iv_history (ticker);
