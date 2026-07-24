-- Phase 3 of the admin "Email" marketing feature: tracking columns for the
-- two automations that don't have an existing table to key "already sent"
-- off of (unlike abandoned_cart/post_purchase_review, which reuse
-- carts.abandoned_cart_email_sent / orders.review_request_sent).

-- welcome: sent at most once ever, right after a customer's first
-- successful signup (email/password or Google) — checked before sending so
-- a repeat login is always a safe no-op.
alter table customers add column welcome_emailed_at timestamptz;

-- birthday: sent at most once per calendar year. A plain "already sent"
-- boolean won't do since this repeats annually — storing the date of the
-- last send lets the cron compare its year against the current year.
alter table customers add column birthday_last_emailed_at date;
