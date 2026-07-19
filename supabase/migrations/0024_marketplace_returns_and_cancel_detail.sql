-- Feature 1: marketplace-driven returns (TikTok/Shopee buyer return & refund
-- requests) need to be de-duped across repeated syncs the same way orders
-- are (see 0001_init_schema.sql's orders.external_order_id unique index) —
-- external_return_id is unique per platform return-line-item.
alter table returns
  add column if not exists external_return_id text;

create unique index if not exists returns_external_return_id_idx
  on returns (external_return_id)
  where external_return_id is not null;

-- Feature 2: platform-provided free text for *why* an order was cancelled
-- (e.g. TikTok's own cancel_reason string) — kept separate from the fixed
-- cancellation_reason enum so staff can see the platform's own wording
-- (which might indicate a failed-delivery auto-cancel) without us having to
-- guess a taxonomy for every possible platform-side cancellation cause.
alter table orders
  add column if not exists cancellation_detail text;
