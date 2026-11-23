-- Community Fits (Spades-only homepage carousel, "Community Fits" in admin
-- under Marketing): Instagram posts where customers tagged Spades. Instagram
-- offers no way to pull a post's image from its link alone, so staff paste
-- the post link, upload the photo themselves, type the poster's @handle,
-- and optionally tag the Spades products shown in the photo.
create table community_fits (
  id uuid primary key default gen_random_uuid(),
  instagram_url text not null,
  image_url text not null,
  handle text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_fits_active_sort_idx
  on community_fits (sort_order)
  where is_active;

alter table community_fits enable row level security;

-- Same shape as community_events (0106): anonymous storefront reads only see
-- active rows; all admin writes go through the service-role client, which
-- bypasses RLS.
create policy "public read active community fits"
  on community_fits for select using (is_active = true);

-- Spades products shown in each fit's photo ("Shop the look" on the tile).
create table community_fit_products (
  fit_id uuid not null references community_fits (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (fit_id, product_id)
);

-- FK index for the product side (the PK already covers fit_id lookups) —
-- keeps product deletes from seq-scanning this table.
create index community_fit_products_product_id_idx
  on community_fit_products (product_id);

alter table community_fit_products enable row level security;

-- Readable only for fits that are themselves publicly visible; the
-- storefront additionally only shows products that are active (products'
-- own "public read active products" policy enforces that on the join).
create policy "public read active community fit products"
  on community_fit_products for select using (
    exists (
      select 1 from community_fits f
      where f.id = community_fit_products.fit_id and f.is_active
    )
  );

-- Photo uploads — same pattern as community-events: uploads go through an
-- admin server function's signed upload URL (service-role), so a public
-- bucket with no storage RLS policies is enough for storefront viewing.
insert into storage.buckets (id, name, public)
values ('community-fits', 'community-fits', true)
on conflict (id) do nothing;
