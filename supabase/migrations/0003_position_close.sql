-- options-copilot: Phase 11 position close/assign
-- Adds the two columns needed to store the final outcome of a closed or
-- assigned position: what it cost to close early (if applicable), and
-- the realized net P/L computed with the same "stock + option leg
-- combined" logic used for open positions -- never the option leg alone.

alter table positions add column if not exists closing_premium numeric;
alter table positions add column if not exists realized_pl numeric;
