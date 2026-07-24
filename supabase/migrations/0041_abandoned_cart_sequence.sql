-- Support a multi-step abandoned-cart email sequence (e.g. 30 min / 8h /
-- 24h / 48h reminders) instead of a single fixed-delay email. The
-- event_type uniqueness added in 0035 only ever intended one automation per
-- event, which is wrong for abandoned_cart specifically now.
alter table email_automations drop constraint email_automations_event_type_key;

-- Still exactly one row for welcome/post_purchase_review/birthday — only
-- abandoned_cart gets multiple rows now.
create unique index email_automations_singleton_event_type_idx
  on email_automations (event_type)
  where event_type != 'abandoned_cart';

-- A 30-minute step needs a fractional value (0.5) — was integer-only.
alter table email_automations
  alter column delay_hours type numeric using delay_hours::numeric;

-- Per-automation send tracking, replacing carts.abandoned_cart_email_sent
-- (a single boolean that could only ever record ONE send per cart — step 2
-- of a sequence would have been permanently blocked by step 1's flag).
-- Scoped to the specific cart (not just the recipient email, unlike
-- email_sends) since the resume link/recovery token in the email is
-- cart-specific.
create table cart_abandonment_sends (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  email_automation_id uuid not null references email_automations(id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (cart_id, email_automation_id)
);

alter table cart_abandonment_sends enable row level security;
-- No policies — service-role only, same convention as email_sends.

drop index if exists carts_abandoned_cart_scan_idx;
alter table carts
  drop column abandoned_cart_email_sent,
  drop column abandoned_cart_emailed_at;

-- Coarse pre-filter for the cron: any cart that COULD qualify for some
-- abandoned-cart automation. Per-automation cutoff/dedup happens in the
-- handler (see api/cron/abandoned-cart.ts).
create index if not exists carts_active_with_email_idx
  on carts (status, created_at) where email is not null;

-- Retime the existing single automation to the fastest step of the new
-- sequence (keeps its id/content/history — it was already live).
update email_automations
  set name = 'Abandoned cart - 30 min', delay_hours = 0.5
  where event_type = 'abandoned_cart';

-- The remaining three steps, cloned from the existing automation's content
-- as a starting point — inactive until the actual copy is reviewed and
-- turned on from the admin Email page.
insert into email_automations (event_type, name, is_active, subject, blocks, delay_hours)
select
  'abandoned_cart',
  steps.name,
  false,
  steps.subject,
  source.blocks,
  steps.delay_hours
from (values
  ('Abandoned cart - 8 hours', 'Still thinking it over?', 8::numeric),
  ('Abandoned cart - 24 hours', 'Your cart is waiting for you', 24::numeric),
  ('Abandoned cart - 48 hours', 'Last chance to complete your order', 48::numeric)
) as steps(name, subject, delay_hours)
cross join (
  select blocks from email_automations
  where event_type = 'abandoned_cart' and name = 'Abandoned cart - 30 min'
) as source;
