-- Order numbers were a random SPD-<base36 timestamp+random> string, which
-- is unique but useless for "find order #1042 in our records" style lookups.
-- Switch to a sequential, human-friendly SPD-1001, SPD-1002, ... scheme —
-- generated in Postgres (not the app) so concurrent checkouts can never
-- collide or skip unpredictably. Existing orders keep their old order_number
-- untouched (some may still be referenced as a pending Xendit external_id),
-- only new rows going forward get the new format.
create sequence order_number_seq start with 1001;

alter table orders
  alter column order_number set default ('SPD-' || nextval('order_number_seq')::text);
