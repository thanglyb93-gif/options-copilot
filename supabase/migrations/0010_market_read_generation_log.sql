-- options-copilot: Phase 43 Part C -- global daily cap on Market-Read-
-- style Anthropic generations. One row per calendar date, keyed by the
-- date itself -- "reset at midnight" falls out for free from the key
-- (a new day just means a new row, starting implicitly at 0), no
-- separate reset job or last-reset timestamp needed. Shared across the
-- whole app: every caller of lib/briefing-service.ts's
-- getBriefingRespectingDailyCap increments the same row.
create table if not exists market_read_generation_log (
  date date primary key,
  count integer not null default 0
);
