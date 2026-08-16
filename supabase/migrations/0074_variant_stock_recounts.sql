-- Powers the admin "Stock Audit" page: flags variants below a stock
-- threshold (or sold out with recent sales) so staff physically recount
-- them. One row per variant holding its *last* recount — clicking
-- "Mark recounted" upserts the variant's quantity_available at that
-- moment, and the audit list hides a row only while the live quantity
-- still matches what was last recounted; any change (more sales, a
-- restock) makes it stale again and the row reappears.
create table variant_stock_recounts (
  variant_id uuid primary key references product_variants(id) on delete cascade,
  recounted_quantity_available integer not null,
  recounted_at timestamptz not null default now(),
  staff_user_id uuid references staff_users(id) on delete set null
);

alter table variant_stock_recounts enable row level security;
