-- Product search ("No-Fold" not matching a search for "no fold") was a
-- plain ilike '%term%' against the raw name, so any punctuation/spacing
-- difference between what's typed and what's stored broke the match.
-- name_search strips everything except letters/digits (lowercased) on
-- both the stored side (here) and the incoming query (normalizeSearchTerm
-- in lib/utils/search.ts), so "No-Fold", "No Fold", and "nofold" all
-- normalize to the same "nofold" and match each other regardless of
-- punctuation.
alter table products add column name_search text
  generated always as (regexp_replace(lower(name), '[^a-z0-9]', '', 'g')) stored;

-- storefront_product_listing (0008_storefront_product_listing_view.sql)
-- needs the same column — views can't inherit a generated column from
-- their base table automatically, so it's recomputed here the same way.
-- name_search must be the LAST column: CREATE OR REPLACE VIEW matches
-- existing columns by ordinal position, so inserting a new one in the
-- middle reads as "rename min_price_cents to name_search" and Postgres
-- rejects it.
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
  regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') as name_search
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
