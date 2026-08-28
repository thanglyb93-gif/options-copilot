-- options-copilot: lean_history tracking
-- Every time a per-ticker briefing regenerates (not on a cache hit --
-- see lib/briefing-service.ts's getOrGenerateBriefing), records the
-- directional lean it produced and the price at that moment. A
-- separate resolve job (/api/lean-resolve) fills in the price 10 real
-- trading days later, once that many have actually elapsed, and
-- classifies whether the lean held up. Purely informational -- not a
-- gate on anything else in the app -- surfaced as a simple accuracy
-- summary on the Guidance page once enough rows have resolved.

create table if not exists lean_history (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  date date not null,
  lean text not null check (lean in ('bullish', 'neutral', 'bearish', 'mixed')),
  price_at_snapshot numeric not null,
  price_after_10_trading_days numeric,
  outcome text check (outcome in ('held_up', 'reversed', 'unclear'))
);

-- Powers the resolve job's "find rows still waiting to be resolved" scan.
create index if not exists lean_history_pending_idx on lean_history (date) where outcome is null;

-- Powers the accuracy summary's "last N days" window query.
create index if not exists lean_history_ticker_date_idx on lean_history (ticker, date);
