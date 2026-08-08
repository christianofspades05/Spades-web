-- Allow a brand to have multiple top banners that rotate on the storefront,
-- instead of exactly one — text/text_ja/text_ko/is_active/updated_at stay
-- per-row, now keyed by a new id instead of brand directly (brand is no
-- longer unique). sort_order controls rotation order; existing 3 rows keep
-- their data and default to sort_order 0.
alter table storefront_banner drop constraint storefront_banner_pkey;
alter table storefront_banner add column id uuid not null default gen_random_uuid();
alter table storefront_banner add column sort_order integer not null default 0;
alter table storefront_banner add primary key (id);

create index storefront_banner_brand_sort_idx on storefront_banner (brand, sort_order);
