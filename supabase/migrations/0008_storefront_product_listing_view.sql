-- Product price lives on product_variants and stock lives on inventory, one
-- level removed from products, so filtering/sorting a paginated storefront
-- listing by price or in-stock status can't be done with a plain PostgREST
-- filter on `products` (embedded-resource filters only shape the nested
-- array, they don't restrict which parent rows come back). This view
-- precomputes a per-product min variant price and total available stock so
-- the listing query can filter/sort/paginate on real columns.
--
-- security_invoker means the view runs with the querying role's own
-- permissions, so the underlying RLS policies on products/product_variants/
-- inventory (public read of active products/active variants) still apply —
-- this view doesn't grant anonymous access to anything RLS wouldn't already.

create or replace view storefront_product_listing
with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.name,
  p.description,
  p.product_type,
  p.images,
  p.tags,
  p.created_at,
  p.updated_at,
  coalesce(v.min_price_cents, 0) as min_price_cents,
  coalesce(v.total_stock, 0) as total_stock
from products p
left join lateral (
  select
    min(pv.price_cents) as min_price_cents,
    sum(coalesce(inv.quantity_available, 0)) as total_stock
  from product_variants pv
  left join inventory inv on inv.variant_id = pv.id
  where pv.product_id = p.id and pv.is_active = true
) v on true
where p.status = 'active';

grant select on storefront_product_listing to anon, authenticated;
