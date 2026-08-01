-- Lets staff set a default category (and default answers to that
-- category's required attributes) per product type, per marketplace — so
-- "Push to Shopee/TikTok" can skip the manual category-search-and-fill
-- flow for the common case (see admin/channels/$marketplace's "Default
-- categories" section). One row per (marketplace, product_type); editing
-- an existing default updates it in place rather than creating overlapping
-- history, same convention as market_pricing's per-country row.
create table marketplace_category_defaults (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('tiktok_shop', 'shopee', 'lazada')),
  product_type product_type not null,
  category_id text not null,
  category_name text not null,
  -- Array of { attributeId: string, valueId?: string, value?: string } —
  -- the exact shape pushProductToMarketplace already expects for
  -- attributeValues, so applying a saved default is just spreading this
  -- straight into that call.
  attribute_defaults jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, product_type)
);

alter table marketplace_category_defaults enable row level security;

-- No policies — service-role admin access only, same as
-- marketplace_connections/marketplace_product_mappings (0001_init_schema.sql).
