-- Lalamove same-day courier checkout option (Spades, Metro Manila only).
-- shipping_method is plain text (not an enum), matching shipments.carrier's
-- existing free-text convention — avoids a migration for every future
-- shipping method. lalamove_info holds the checkout-time quotation +
-- dropoff pin: { quotationId, pickupStopId, dropoffStopId, dropoffLat,
-- dropoffLng, dropoffAddress, estimatedFeeCents, quotedAt }. Deliberately
-- NOT stored as a `shipments` row yet — inserting into shipments flips
-- orders.has_shipment true via the trigger in 0048_orders_has_shipment.sql,
-- which the admin Orders page reads as "Fulfilled". A Lalamove order isn't
-- fulfilled until staff actually books the trip (see bookLalamoveShipment
-- in src/server/admin/orders.ts), so the pending info lives here instead.
alter table orders
  add column shipping_method text not null default 'standard',
  add column lalamove_info jsonb;

alter table checkout_reservations
  add column shipping_method text not null default 'standard',
  add column lalamove_info jsonb;
