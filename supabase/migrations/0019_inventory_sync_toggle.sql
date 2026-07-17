-- Connecting/pushing a product to a channel should only ever link it —
-- pushing our stock numbers to a platform that's already being synced by
-- another tool (e.g. an existing Shopify app) risks overwriting numbers a
-- live shop's customers can see. This makes inventory sync an explicit,
-- separate opt-in per channel connection, off by default.
alter table marketplace_connections
  add column if not exists inventory_sync_enabled boolean not null default false;
