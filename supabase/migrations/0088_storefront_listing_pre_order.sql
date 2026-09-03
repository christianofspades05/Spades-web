-- Adds pre-order visibility to the storefront listing view (backs
-- /products and, via ProductCard, its "Out of stock"/"Sale" badges) so a
-- product with zero real stock but available pre-order quantity can show a
-- "Pre-Order" badge on grid cards, not just its own detail page. Purely
-- additive — total_stock's existing computation/semantics (used for
-- in-stock filtering and sorting) is untouched.
--
-- Must stay the LAST column — CREATE OR REPLACE VIEW matches by ordinal
-- position (see 0049/0051's own comments on this view).
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
  coalesce(v.total_stock, 0) as total_stock,
  regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') as name_search,
  p.brand,
  coalesce(v.has_pre_order_stock, false) as has_pre_order_stock
from products p
left join lateral (
  select
    min(pv.price_cents) as min_price_cents,
    sum(coalesce(inv.quantity_available, 0)) as total_stock,
    bool_or(pv.is_pre_order and pv.pre_order_available > 0) as has_pre_order_stock
  from product_variants pv
  left join inventory inv on inv.variant_id = pv.id
  where pv.product_id = p.id and pv.is_active = true
) v on true
where p.status = 'active';

grant select on storefront_product_listing to anon, authenticated;
