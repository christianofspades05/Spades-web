-- Per-order email thread: lets staff send an ad-hoc email to the customer
-- about their order (e.g. "delayed 7 days due to a typhoon") and see the
-- customer's replies, right on the order detail page. 'outbound' rows are
-- written when staff sends one; 'inbound' rows are written by the Resend
-- inbound-email webhook (see src/routes/api/webhooks/resend-inbound.ts)
-- when a reply comes back to that order's unique reply-to address.
create table order_email_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  subject text not null,
  body_html text,
  body_text text,
  from_address text not null,
  to_address text not null,
  -- Resend's own id for this email (send response id for outbound, the
  -- received email's id for inbound) — a partial unique index below makes
  -- inbound webhook retries idempotent.
  resend_email_id text,
  -- Only set for outbound (who sent it); null for inbound and set null if
  -- that staff account is later removed rather than blocking the delete.
  staff_user_id uuid references staff_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_email_messages_order_id_created_at_idx
  on order_email_messages(order_id, created_at);

create unique index order_email_messages_resend_email_id_idx
  on order_email_messages(resend_email_id)
  where resend_email_id is not null;

-- Same convention as every other table (see 0001_init_schema.sql): only the
-- service-role admin client (staff-facing server fns + the inbound webhook)
-- ever touches this, which bypasses RLS entirely. Enabling RLS with no
-- anon/authenticated policies just makes sure the auto-generated REST API
-- can't expose it via the public anon key.
alter table order_email_messages enable row level security;
