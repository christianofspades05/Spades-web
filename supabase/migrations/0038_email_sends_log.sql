-- Phase 4 of the admin "Email" marketing feature: a log of every actual
-- send, so the automations list can report real sends/conversion stats
-- (see server/admin/email-automations.ts) instead of just attributed
-- revenue. One row per successful send from any of the 4 cron/server-fn
-- paths (abandoned-cart, review-requests, birthday, welcome-email) —
-- written only after sendEmail() succeeds, same "only mark it done once it
-- actually went out" discipline those routes already use for their own
-- per-cart/order/customer flags.
create table email_sends (
  id uuid primary key default gen_random_uuid(),
  email_automation_id uuid not null references email_automations (id) on delete cascade,
  recipient_email text not null,
  -- The specific single-use code minted for this send, if the automation
  -- had a discount template attached (see 0037_discount_per_recipient_codes.sql)
  -- — kept even if that discount is later deleted, since this is a
  -- historical log entry, not a live reference.
  discount_id uuid references discounts (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index email_sends_automation_id_sent_at_idx on email_sends (email_automation_id, sent_at desc);

-- Staff-only resource, same convention as email_automations: RLS enabled
-- with zero client-facing policies — only the service-role key (server-only)
-- can touch this table.
alter table email_sends enable row level security;
