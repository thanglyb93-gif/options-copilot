-- options-copilot: Phase 16 headline classification cache
-- Permanent (no-TTL) cache of each headline's macro/individual level and
-- category, keyed by a stable id (article URL, or a hash of
-- headline+date -- see lib/headline-classification-service.ts). A
-- headline's classification never changes once published, so there's no
-- freshness check on read -- an id present in this table is never
-- re-sent to Claude.

create table if not exists headline_classifications (
  id text primary key,
  level text not null check (level in ('macro', 'individual')),
  category text not null,
  classified_at timestamptz not null default now()
);

create index if not exists headline_classifications_level_idx on headline_classifications (level);
