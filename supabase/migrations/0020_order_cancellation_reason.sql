-- Feeds the new Cancelled and Returns analytics page's "per reason"
-- breakdown — without this, cancelling an order had no way to record why.
create type order_cancellation_reason as enum (
  'failed_delivery',
  'customer_request',
  'out_of_stock'
);

alter table orders
  add column if not exists cancellation_reason order_cancellation_reason;
