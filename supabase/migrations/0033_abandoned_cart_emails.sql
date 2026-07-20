-- Abandoned-cart email automation. Opaque random tokens looked up directly
-- in a DB column (same pattern as orders.review_token), not signed JWTs.
--
-- Two separate tokens (recovery_token, unsubscribe_token) rather than one
-- shared token: they gate different-severity actions. A resume link is the
-- kind of thing that ends up forwarded, in browser history, or GET-prefetched
-- by a corporate link scanner — none of which should also carry the power to
-- kill someone's marketing subscription. Splitting them costs one column and
-- removes that coupling entirely.
alter table carts
  add column email text,
  add column recovery_token text unique,
  add column unsubscribe_token text unique,
  add column abandoned_cart_email_sent boolean not null default false,
  add column abandoned_cart_emailed_at timestamptz;

-- Supports the cron's coarse pre-filter. Can't fully express "no activity
-- in the last hour" (also depends on cart_items.updated_at, checked in the
-- cron handler), but never excludes a cart that might qualify, since no
-- cart_items row can predate its parent cart's created_at.
create index if not exists carts_abandoned_cart_scan_idx
  on carts (status, abandoned_cart_email_sent, created_at)
  where email is not null;

-- Unsubscribe applies to the email address going forward, not to one cart —
-- stays unsubscribed even from a brand-new guest cart with no cookie
-- relationship to the one that triggered the email. email is the natural
-- key (always stored lowercased/trimmed), so the insert is a trivial
-- idempotent upsert if a link gets clicked twice.
create table email_unsubscribes (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table email_unsubscribes enable row level security;
-- No policies — written/read exclusively through the service-role admin
-- client (the cron job and the unsubscribe route), same convention as
-- carts/cart_items.
