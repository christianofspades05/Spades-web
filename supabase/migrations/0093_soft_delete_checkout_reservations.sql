-- Fixes a confirmed production bug: a late PAID/CAPTURE-COMPLETED event
-- arriving after the reservation was already released (EXPIRED/FAILED/
-- DENIED, or the 15-min cron backstop) had nothing left to mint an order
-- from — checkout_reservations was hard-deleted the moment we believed a
-- payment was abandoned, even though every safeguard that decides "this is
-- truly abandoned" is itself a live status check against the payment
-- provider, which can still be wrong (the provider's own PAID confirmation
-- lagging the real payment, or — seen live — a payment rail completing a
-- transfer minutes after the provider's own invoice had already expired).
--
-- Fix: never hard-delete a reservation on release, only mark it released.
-- A late payment-confirmation event now finds the same row it always did
-- (the `id` lookup is unchanged) and can still mint the order from it. Only
-- `mint_checkout_order` itself still hard-deletes, once an order has
-- actually been created from the row — see 0091_creator_management.sql.
alter table checkout_reservations
  add column released_at timestamptz;

comment on column checkout_reservations.released_at is
  'Set instead of deleting when a reservation is believed abandoned/expired/denied, so a late payment-confirmation event can still recover it. NULL = still an active in-progress checkout.';
