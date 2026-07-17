-- Multi-channel marketplace sync ("SyncMate"): connects Spades to TikTok
-- Shop first, with Shopee and Lazada plugging into the same shape once
-- their API accounts are approved (see src/server/integrations/marketplaces).
--
-- marketplace_connections and marketplace_product_mappings already exist
-- (0001_init_schema.sql) — this just extends their enums to cover Lazada and
-- an explicit 'error' connection state, rather than creating a second,
-- competing pair of tables. order_source/external_order_id were already
-- there too, per that migration's own comment ("support future marketplace
-- integrations") — this adds the missing 'lazada' value and a column for
-- the raw payload, so orders imported from a channel keep their original
-- API response for debugging.
alter type order_source add value if not exists 'lazada';
alter type marketplace_name add value if not exists 'lazada';
alter type marketplace_connection_status add value if not exists 'error';

alter table orders
  add column if not exists platform_order_data jsonb;

-- -----------------------------------------------------------------------------
-- sync_logs
-- Every push/pull attempt gets a row, success or failure — this is how a
-- rate-limited or down platform API becomes visible instead of silently
-- failing. `detail` holds whatever's useful per operation (variant id,
-- order count pulled, attempt number, etc.), not a fixed shape.
-- -----------------------------------------------------------------------------
create type sync_log_status as enum ('success', 'failed');

create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  marketplace marketplace_name not null,
  operation text not null,
  status sync_log_status not null,
  detail jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now()
);
create index sync_logs_marketplace_created_at_idx on sync_logs (marketplace, created_at desc);

alter table sync_logs enable row level security;
