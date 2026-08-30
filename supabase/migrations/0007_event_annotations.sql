-- options-copilot: Phase 32 Event Timeline annotation cache
-- A past event's facts never change once computed (a historical price
-- move, an earnings date, and whatever news genuinely coincided with it
-- are all fixed facts about the past) -- so unlike briefings or insider
-- activity, this has no TTL at all. Once a ticker+date+type annotation
-- is computed, it's permanent; only newly-requested dates not already
-- present get computed on a later view. See lib/event-timeline.ts.

create table if not exists event_annotations (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  date date not null,
  type text not null check (type in ('earnings', 'large-move', 'macro')),
  pct_change numeric,
  headline text,
  source text,
  classification text,
  unique (ticker, date, type)
);

-- Powers the "already cached in this date range" lookup the timeline route does on every request.
create index if not exists event_annotations_ticker_date_idx on event_annotations (ticker, date);
