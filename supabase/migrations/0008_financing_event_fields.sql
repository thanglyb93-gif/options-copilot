-- Phase 33: extends the permanent headline_classifications cache with two
-- fields only meaningful for the new 'financing-event' individual category
-- (debt/convertible-note offerings, share exchanges, secondary offerings,
-- lockup expirations) -- nullable, since every pre-existing row and every
-- non-financing-event classification simply has no value here.
alter table headline_classifications
  add column if not exists financing_status text check (financing_status in ('announced', 'pricing', 'closing-settled')),
  add column if not exists financing_event_date date;
