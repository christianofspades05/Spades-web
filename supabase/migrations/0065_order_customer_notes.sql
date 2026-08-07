-- Customer-submitted checkout notes (delivery instructions, etc.), shown
-- read-only to staff on the order detail page. Deliberately a separate
-- column from the pre-existing orders.notes, which is staff-editable
-- internal notes — keeping the two apart avoids a customer's note ever
-- being silently overwritten by a staff edit or vice versa.
alter table checkout_reservations add column customer_notes text;
alter table orders add column customer_notes text;
