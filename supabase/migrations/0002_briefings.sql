-- options-copilot: Phase 5 briefing cache
-- Stores the most recent Claude-generated market intelligence briefing per
-- ticker, so /api/briefing/[ticker] only calls the Anthropic API when the
-- cached entry is missing or older than 4 hours.

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  content jsonb not null,
  generated_at timestamptz not null default now()
);
