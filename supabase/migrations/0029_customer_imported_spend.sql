-- Historical Shopify spend for customers imported from the Online Store
-- customer export (or matched against it for existing customers who also
-- appear there). This is a one-time-set historical baseline, not a live
-- counter — "Amount Spent" in the app blends this with a live sum of the
-- customer's real orders.total_cents, the same way order/return counts are
-- already computed live rather than trusted from a stale column.
alter table customers add column imported_total_spent_cents integer null;
