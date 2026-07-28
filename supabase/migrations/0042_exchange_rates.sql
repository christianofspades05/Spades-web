-- Cached FX rates for the storefront's display-currency selector and, for
-- card payments, the actual amount charged via Xendit. Refreshed daily by
-- api/cron/sync-exchange-rates — a table (not a live call per page load)
-- so browsing never depends on an external rate API's uptime/latency.
create table exchange_rates (
  currency text primary key,
  rate_to_php numeric not null,
  updated_at timestamptz not null default now()
);

alter table exchange_rates enable row level security;

-- Public storefront read — every visitor needs these to render converted
-- prices, and there's nothing sensitive in an exchange rate.
create policy "Exchange rates are publicly readable"
  on exchange_rates for select
  using (true);

-- No insert/update/delete policy — only the service-role cron writes.
