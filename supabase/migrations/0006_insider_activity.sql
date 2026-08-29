-- options-copilot: Phase 29 insider-activity (SEC EDGAR Form 4) cache
-- Stores the most recent aggregated insider-activity summary per ticker,
-- so /api/insider/[ticker] only hits SEC EDGAR when the cached entry is
-- missing or older than the TTL (see lib/insider-service.ts) -- this data
-- doesn't change intraday, so a long TTL is appropriate and keeps this app
-- a well-behaved SEC EDGAR client.

create table if not exists insider_activity (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  content jsonb not null,
  generated_at timestamptz not null default now()
);
