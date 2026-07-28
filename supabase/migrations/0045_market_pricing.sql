-- Per-country product-price markup for international orders. Keyed by
-- shipping destination (the country collected at checkout), never by
-- display currency — see src/lib/checkout/market-pricing.ts. One row per
-- country; editing a country's rate updates its existing row.
create table market_pricing (
  id uuid primary key default gen_random_uuid(),
  country_code text not null unique,
  markup_percent numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table market_pricing enable row level security;

-- Public read — checkout needs to show the same marked-up total it's about
-- to charge, before the order is placed (same reasoning as exchange_rates'
-- "publicly readable" policy). No write policy — only the service-role
-- admin client mutates it.
create policy "Market pricing is publicly readable"
  on market_pricing for select
  using (true);

-- Records what markup (if any) actually applied to an order, for admin
-- visibility/audit — mirrors payments.fx_rate_to_php's "record what was
-- applied" pattern from the currency-charging work.
alter table orders add column market_markup_percent numeric;
