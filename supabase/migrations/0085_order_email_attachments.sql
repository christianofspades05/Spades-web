-- The Resend inbound webhook (src/routes/api/webhooks/resend-inbound.ts)
-- only ever read an inbound email's html/text body — a customer reply with
-- a photo attached silently lost the photo, since nothing fetched or stored
-- it. Resend's Received Emails API never includes attachment content inline
-- (only a separate metadata+download_url endpoint, and that download_url
-- expires after 1 hour), so the webhook re-uploads each attachment to this
-- bucket immediately and stores the resulting permanent URLs here instead.
alter table order_email_messages
  add column attachments jsonb;

comment on column order_email_messages.attachments is
  'Array of {filename, contentType, size, url} for inbound emails with attachments — url points at the order-email-attachments bucket, not Resend''s short-lived download_url. Null/absent for outbound messages and inbound messages with no attachments.';

-- Same pattern as product-images/review-photos/shipment-photos (see
-- 0005_tags_and_media_storage.sql): the webhook uploads via the
-- service-role admin client, which bypasses storage RLS entirely, so a
-- public bucket with no RLS policies is enough for staff to view the
-- resulting URLs in the admin order-emails thread.
insert into storage.buckets (id, name, public)
values ('order-email-attachments', 'order-email-attachments', true)
on conflict (id) do nothing;
