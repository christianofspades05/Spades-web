-- Marketplace order-pull sync now mirrors a platform-side cancellation
-- (e.g. a TikTok Shop order the buyer cancelled after we'd already imported
-- it) onto our own orders.status. None of the existing staff-facing reasons
-- (failed_delivery/customer_request/out_of_stock) accurately describe that
-- case, so it gets its own value instead of guessing one of the three.
alter type order_cancellation_reason add value if not exists 'platform_cancelled';
