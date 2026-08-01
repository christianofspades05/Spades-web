-- Per-brand maintenance mode — when a brand's row is active, that brand's
-- storefront (Spades/Ysrael/Aspire 365) shows a maintenance page instead
-- of its normal site, while the shared admin panel stays fully usable
-- regardless (so staff can always turn it back off). One row per brand,
-- seeded below so the admin toggle is always a plain update, never an
-- upsert-or-insert.
create table storefront_maintenance_mode (
  brand text primary key check (brand in ('spades', 'ysrael', 'aspire365')),
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into storefront_maintenance_mode (brand) values
  ('spades'), ('ysrael'), ('aspire365');

alter table storefront_maintenance_mode enable row level security;

-- Every storefront page load needs to check this before rendering, and
-- there's nothing sensitive in it — same reasoning as exchange_rates'
-- "publicly readable" policy (0042_exchange_rates.sql).
create policy "Maintenance mode is publicly readable"
  on storefront_maintenance_mode for select
  using (true);

-- No insert/update/delete policy — only the service-role admin toggles it.
