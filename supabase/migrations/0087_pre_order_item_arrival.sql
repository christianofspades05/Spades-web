-- An order can have pre-order lines for more than one variant (the
-- cart-mixing rule only blocks pre-order-vs-regular, not pre-order-vs-
-- another-pre-order), and each variant's stock can arrive at a different
-- time. Tracking arrival per line (rather than trying to infer it from
-- product_variants.pre_order_reserved, which is shared across every order
-- waiting on that variant) is what lets receivePreOrderStock correctly
-- decide when an order's LAST pre-order line has cleared and the whole
-- order can be marked orders.pre_order_ready_at.
alter table order_items
  add column pre_order_stock_arrived_at timestamptz;
