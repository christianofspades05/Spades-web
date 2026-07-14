# integrations/shipmate

Not implemented yet.

Planned scope: warehouse scanning/packing verification against `orders` and
`order_items`, writing `shipments` rows (tracking number, `packed_by`
staff_user_id, timestamps), and feeding staff KPIs from
`inventory_movements` / `shipments` data. Auth between Spades and ShipMate
will likely be a service-to-service API key, stored server-only (never in
client env vars).
