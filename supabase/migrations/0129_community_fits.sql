-- Community Fits (Spades-only homepage carousel, "Community Fits" in admin
-- under Marketing): Instagram posts where customers tagged Spades. Instagram
-- offers no way to pull a post's image from its link alone, so staff paste
-- the post link, upload the photo themselves, and type the poster's @handle.
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

-- Photo uploads — same pattern as community-events: uploads go through an
-- admin server function's signed upload URL (service-role), so a public
-- bucket with no storage RLS policies is enough for storefront viewing.
insert into storage.buckets (id, name, public)
values ('community-fits', 'community-fits', true)
on conflict (id) do nothing;
