-- options-copilot: Phase 39 real-time position news alerts
-- Records every alert email actually sent, keyed by ticker + a stable
-- headline id (see lib/headline-classification-service.ts's
-- stableHeadlineId, reused directly as headline_hash) -- the unique
-- constraint is what prevents sending the same alert twice across
-- polling runs, and MAX(sent_at) per ticker doubles as the
-- last-checked-at watermark so no separate settings table is needed.
create table if not exists alert_log (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  headline_hash text not null,
  sent_at timestamptz not null default now(),
  unique (ticker, headline_hash)
);

create index if not exists alert_log_ticker_idx on alert_log (ticker);
