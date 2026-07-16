-- Two small additive fields requested from the admin: a per-collection
-- storefront display rule, and per-variant cost tracking for margin visibility
-- in the Inventory page. Both are nullable/defaulted so existing rows are
-- unaffected.

alter table collections
  add column hide_out_of_stock_products boolean not null default false;

alter table product_variants
  add column cost_cents integer check (cost_cents is null or cost_cents >= 0);
