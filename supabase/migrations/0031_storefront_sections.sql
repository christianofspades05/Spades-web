-- Lets staff edit the homepage (hero image, tagline text, photo/video
-- blocks, and which collections to feature) from the admin panel instead of
-- a developer editing src/routes/index.tsx directly. One row per section,
-- ordered by sort_order; `type` determines which of the other columns are
-- actually used (see src/lib/validation/admin/storefront-sections.ts for the
-- per-type field requirements enforced at the application layer — kept
-- loose here since Postgres check constraints can't express "these columns
-- are required only when type = X" cleanly):
--   hero            -- full-bleed clickable image banner (media_url, link_url)
--   tagline         -- heading + body text statement (title, subtitle)
--   image           -- plain full-width image (media_url, link_url)
--   video           -- full-width autoplay video (media_url)
--   product_grid    -- one collection's products as a grid (title,
--                       collection_id, link_url for the "View all" button)
-- The old homepage's single "Collections" block covering many collections
-- at once becomes several product_grid sections instead — more flexible
-- (staff can reorder/hide one collection without touching the rest), same
-- visual result.
create table storefront_sections (
  id uuid primary key default gen_random_uuid(),
  type text not null check (
    type in ('hero', 'tagline', 'image', 'video', 'product_grid')
  ),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  title text,
  subtitle text,
  media_url text,
  link_url text,
  collection_id uuid references collections (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index storefront_sections_sort_order_idx
  on storefront_sections (sort_order);

alter table storefront_sections enable row level security;

-- Same shape as every other public-facing catalog table (collections,
-- products, ...) — anonymous storefront reads only see active rows; all
-- writes go through the admin (service-role) client from the admin panel,
-- which bypasses RLS entirely, so no separate write policy is needed here.
create policy "public read active storefront sections"
  on storefront_sections for select using (is_active = true);

-- Storage bucket for hero/tagline/image/video section media — same pattern
-- as product-images (see 0005_tags_and_media_storage.sql): uploads always
-- go through the admin server function using the service-role client, which
-- bypasses storage RLS entirely, so a public bucket with no RLS policies is
-- enough for the resulting URLs to be viewable on the storefront.
insert into storage.buckets (id, name, public)
values ('storefront-sections', 'storefront-sections', true)
on conflict (id) do nothing;
