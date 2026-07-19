-- Lets staff drag-reorder a product's variants (they previously rendered in
-- whatever order Postgres happened to return, not a chosen order).
alter table product_variants add column sort_order integer not null default 0;

-- Backfill existing variants with a stable initial order based on creation
-- time, so pre-existing products don't all collapse to sort_order = 0 and
-- become arbitrarily ordered again.
with ranked as (
  select id, row_number() over (partition by product_id order by created_at) - 1 as rn
  from product_variants
)
update product_variants
set sort_order = ranked.rn
from ranked
where product_variants.id = ranked.id;

create index if not exists product_variants_product_id_sort_order_idx
  on product_variants (product_id, sort_order);
