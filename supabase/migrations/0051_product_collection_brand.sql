-- Explicit brand field on products/collections, replacing the fragile
-- collection-membership/name-matching scheme that used to decide which of
-- Spades/Ysrael/Aspire 365's storefront a product belonged to (manual
-- product_collections rows for Ysrael, a "name contains 'Aspire 365'" rule
-- for Aspire 365 — see server/storefront/domain.ts's per-brand
-- collectionSlug). brand is now the single source of truth for storefront
-- routing; collections stay a separate, orthogonal concept (their own
-- brand tag below is just for filtering the admin Collections list).
alter table products add column brand text not null default 'spades'
  check (brand in ('spades', 'ysrael', 'aspire365'));
create index if not exists products_brand_idx on products (brand);

alter table collections add column brand text not null default 'spades'
  check (brand in ('spades', 'ysrael', 'aspire365'));

-- Tag the two existing brand-scoping collections with their own brand, for
-- the admin Collections list's new Brand filter. Every product's brand
-- defaults to 'spades' above regardless of any existing collection
-- membership — this deliberately clears the Ysrael/Aspire 365 collections'
-- products back onto Spades; reassign brand via each product's edit page.
update collections set brand = 'ysrael' where slug = 'ysrael';
update collections set brand = 'aspire365' where slug = 'aspire-365';

-- storefront_product_listing (0008_storefront_product_listing_view.sql,
-- extended by 0049) needs brand too, since storefront queries now filter
-- by it directly. Must stay the LAST column — CREATE OR REPLACE VIEW
-- matches by ordinal position (see 0049's comment).
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
  p.brand
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
