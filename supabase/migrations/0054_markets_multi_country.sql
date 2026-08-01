-- Restructures market_pricing (one row per country) into markets (one row
-- per group of countries sharing a single markup) + market_countries (the
-- countries each market covers) — lets staff group e.g. Japan + South Korea
-- under one 90% market instead of creating and separately maintaining two
-- identical entries.
create table markets (
  id uuid primary key default gen_random_uuid(),
  markup_percent numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table market_countries (
  market_id uuid not null references markets(id) on delete cascade,
  country_code text not null,
  primary key (market_id, country_code)
);

-- A country can only belong to one market at a time — otherwise which
-- markup would apply is ambiguous.
create unique index market_countries_country_code_key on market_countries(country_code);

alter table markets enable row level security;
alter table market_countries enable row level security;

-- Public read — checkout needs to show the same marked-up total it's about
-- to charge, before the order is placed (same reasoning as market_pricing's
-- own policy, and exchange_rates' before that). No write policy — only the
-- service-role admin client mutates these.
create policy "Markets are publicly readable"
  on markets for select
  using (true);

create policy "Market countries are publicly readable"
  on market_countries for select
  using (true);

-- Carry over whatever market_pricing rows already exist. Reusing the old
-- row's id as the new market's id means this is a straight 1:1 copy with no
-- risk of an ambiguous join, regardless of how many rows existed.
insert into markets (id, markup_percent, is_active, created_at, updated_at)
select id, markup_percent, is_active, created_at, updated_at from market_pricing;

insert into market_countries (market_id, country_code)
select id, country_code from market_pricing;

drop table market_pricing;
