-- Day-of reminder emails with a self-serve "cancel my slot" link. Same
-- opaque-random-token-in-a-column pattern as orders.review_token /
-- carts.unsubscribe_token (see review-token.ts's own comment on why: an
-- unguessable string looked up directly, not a signed JWT, so a stray
-- link scanner or forward can't be mistaken for staff auth and nothing
-- needs a signature-blocklist to revoke it after use — hitting the real
-- cancel action is a separate, explicit staff-only RPC call, not something
-- that fires just from loading the link).
alter table event_registrations
  add column cancel_token text unique,
  add column reminder_sent_at timestamptz;
