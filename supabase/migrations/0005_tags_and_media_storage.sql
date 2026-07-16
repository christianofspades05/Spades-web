-- Product tags (free-form keywords, shown as chips in the admin and usable
-- as a collection auto-match condition — "Tag is equal to / is not equal to").
alter table products add column tags text[] not null default '{}';
create index products_tags_idx on products using gin (tags);

-- Storage bucket for uploaded product images (as an alternative to pasting an
-- image URL). Uploads always go through the admin server function using the
-- service-role client, which bypasses storage RLS entirely — so no RLS
-- policies are needed here, just a public bucket so the resulting URLs are
-- viewable on the storefront.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
