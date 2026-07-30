-- Distinguishes an auto-cancelled, never-paid online order (see
-- api/cron/expire-unpaid-orders.ts) from the existing cancellation reasons,
-- none of which fit "customer never completed Xendit payment."
alter type order_cancellation_reason add value if not exists 'payment_expired';
