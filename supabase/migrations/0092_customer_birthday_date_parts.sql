-- api/cron/birthday.ts used to fetch every marketing-opted-in customer with
-- a date_of_birth set, then filter down to "born today" in JS — meaning the
-- daily birthday cron re-read the entire opted-in customer base every run
-- just to find the handful whose birthday actually falls today. These two
-- generated columns (same `generated always as (...) stored` pattern as
-- quantity_available in 0001 and search_normalized in 0049) let the query
-- filter by month/day directly in Postgres instead, so the cron only ever
-- reads today's actual candidates.
alter table customers
  add column birth_month smallint generated always as (extract(month from date_of_birth)::smallint) stored,
  add column birth_day smallint generated always as (extract(day from date_of_birth)::smallint) stored;

create index if not exists customers_birthday_lookup_idx
  on customers (birth_month, birth_day)
  where marketing_opt_in = true;
