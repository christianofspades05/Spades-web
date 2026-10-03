-- Lets staff backdate a restock to when stock actually physically arrived
-- (received Monday, logged Wednesday) rather than always stamping "today" —
-- distinct from created_at, which stays "when this record was written" for
-- audit purposes. Null for every existing/other movement type; only the new
-- Restock flow (server/admin/products.ts's recordRestock) sets this. Any
-- read of "the restock date" falls back to created_at when this is null.
alter table inventory_movements add column occurred_at date;
