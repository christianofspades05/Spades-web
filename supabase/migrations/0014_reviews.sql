-- Post-purchase review system: customers get a review-request email 14 days
-- after an order (see the api/cron/review-requests server route), follow a
-- single-use tokenized link to /review/[token], and submit a rating/text/
-- photos per product they bought. Reviews need staff approval before they
-- ever show on the storefront.
create type review_status as enum ('pending', 'approved', 'rejected');

create table reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  customer_email text not null,
  customer_name text,
  rating integer not null check (rating between 1 and 5),
  review_text text,
  photo_urls text[] not null default '{}',
  status review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One review per product per order — the submission page shows one
  -- rating/text block per distinct product in the order and submits them
  -- together, so there's never a legitimate reason for a second row.
  unique (order_id, product_id)
);
create index reviews_product_id_idx on reviews (product_id);
create index reviews_status_idx on reviews (status);

alter table reviews enable row level security;

-- Same convention as products/collections/inventory: the storefront reads
-- this straight through the anon-key server client (src/lib/supabase/server.ts),
-- so approved reviews need a public read policy. Moderation and submission
-- both go through the service-role admin client instead, bypassing this
-- entirely, so no anon insert/update policy is needed.
create policy "public read approved reviews" on reviews for select using (status = 'approved');

-- review_token is the single-use, unguessable link identifier — a random
-- opaque string looked up in the DB (not a JWT), so it can be invalidated
-- instantly by setting review_token_used_at rather than needing a signature
-- blocklist. review_request_sent is the "don't email this order twice" guard;
-- review_requested_at is just a record of when.
alter table orders
  add column review_requested_at timestamptz,
  add column review_request_sent boolean not null default false,
  add column review_token text unique,
  add column review_token_expires_at timestamptz,
  add column review_token_used_at timestamptz;

create index orders_review_token_idx on orders (review_token);

insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;
