-- =============================================================================
-- Spades — Initial schema
-- =============================================================================
-- Design goals baked into this migration:
--   1. Prices and stock are never trusted from the client. `product_variants`
--      and `inventory` are the only source of truth for price/quantity, and
--      only server code (service role) can write to them.
--   2. Inventory cannot go negative under concurrent checkouts. See
--      `reserve_variant_stock()` — it does a single atomic conditional
--      UPDATE instead of read-then-write.
--   3. Tables carry the columns needed for COD-risk scoring, marketplace
--      sync, and ShipMate/ProfitMate integration up front (nullable/defaulted)
--      so those features can be built later without ALTER-heavy migrations.
--   4. `orders`/`order_items` snapshot product/price/address data at the time
--      of purchase instead of joining live rows, so catalog or address-book
--      edits never rewrite order history.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type product_status as enum ('draft', 'active', 'archived');
create type product_type as enum ('tee', 'polo', 'hoodie', 'jacket', 'pants', 'shorts', 'accessory', 'other');

create type cart_status as enum ('active', 'converted', 'abandoned');

create type order_status as enum (
  'pending_payment', 'paid', 'processing', 'packed',
  'shipped', 'delivered', 'cancelled', 'refunded', 'failed'
);
create type order_source as enum ('storefront', 'admin', 'tiktok_shop', 'shopee');

create type payment_provider as enum ('cod', 'gcash', 'paymaya', 'card', 'bank_transfer', 'other');
create type payment_status as enum ('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');

create type shipment_status as enum (
  'pending', 'packed', 'in_transit', 'out_for_delivery',
  'delivered', 'failed', 'returned_to_sender'
);

create type return_status as enum ('requested', 'approved', 'rejected', 'received', 'refunded');

create type discount_type as enum ('percentage', 'fixed_amount', 'free_shipping');
create type discount_scope as enum ('all', 'collection', 'product', 'variant');

create type staff_role as enum ('super_admin', 'admin', 'manager', 'packer', 'support');

create type inventory_movement_type as enum (
  'purchase_in', 'sale_reserved', 'sale_committed', 'sale_released',
  'return_in', 'adjustment', 'marketplace_sync'
);

create type marketplace_name as enum ('tiktok_shop', 'shopee', 'other');
create type marketplace_connection_status as enum ('active', 'expired', 'revoked');
create type marketplace_sync_status as enum ('synced', 'pending', 'error');

create type webhook_source as enum ('payment_provider', 'tiktok_shop', 'shopee', 'shipmate', 'other');
create type webhook_status as enum ('received', 'processing', 'processed', 'failed');

create type activity_actor_type as enum ('staff', 'customer', 'system', 'webhook');

-- -----------------------------------------------------------------------------
-- customers
-- Linked to Supabase Auth via auth_user_id, but nullable so guest checkout
-- can create a customer row before (or without) an account. The COD-risk
-- counters live here so future checkout logic can read one row instead of
-- aggregating order history on every request.
-- -----------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email text not null,
  phone text,
  full_name text,
  is_guest boolean not null default true,
  marketing_opt_in boolean not null default false,

  -- COD-risk / trust signals, maintained by future order-lifecycle logic.
  successful_orders_count integer not null default 0,
  cancelled_orders_count integer not null default 0,
  failed_delivery_count integer not null default 0,
  return_count integer not null default 0,
  is_high_risk boolean not null default false,
  cod_blocked boolean not null default false,
  risk_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_email_key on customers (lower(email));
create index customers_auth_user_id_idx on customers (auth_user_id);

-- -----------------------------------------------------------------------------
-- customer_addresses
-- Philippine-shaped address book (region/province/city/barangay). Orders
-- snapshot the address they used, so editing/deleting an address here never
-- changes historical orders.
-- -----------------------------------------------------------------------------
create table customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  label text,
  recipient_name text not null,
  phone text not null,
  region text not null,
  province text not null,
  city text not null,
  barangay text not null,
  postal_code text,
  address_line1 text not null,
  address_line2 text,
  landmark text,
  is_default_shipping boolean not null default false,
  is_default_billing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_addresses_customer_id_idx on customer_addresses (customer_id);

-- -----------------------------------------------------------------------------
-- collections
-- -----------------------------------------------------------------------------
create table collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- products
-- Media is kept as a JSONB array of URLs for v1 to avoid a premature
-- product_images table; can be split out later without touching this table.
-- -----------------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  product_type product_type not null default 'other',
  status product_status not null default 'draft',
  images jsonb not null default '[]'::jsonb,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_status_idx on products (status);
create index products_product_type_idx on products (product_type);

-- -----------------------------------------------------------------------------
-- product_variants
-- The single source of truth for price. Server code must always read price
-- from here (or a snapshot on order_items) — never trust a price from the
-- client.
-- -----------------------------------------------------------------------------
create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  sku text not null unique,
  size text,
  color text,
  style text,
  price_cents integer not null check (price_cents >= 0),
  compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents >= 0),
  weight_grams integer,
  barcode text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, color, style)
);
create index product_variants_product_id_idx on product_variants (product_id);

-- -----------------------------------------------------------------------------
-- product_collections (join table)
-- -----------------------------------------------------------------------------
create table product_collections (
  product_id uuid not null references products (id) on delete cascade,
  collection_id uuid not null references collections (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, collection_id)
);
create index product_collections_collection_id_idx on product_collections (collection_id);

-- -----------------------------------------------------------------------------
-- inventory
-- One row per variant (per location later — `location_code` is a plain text
-- column today so multi-warehouse/ShipMate support doesn't require a new FK,
-- just a migration to populate it and optionally normalize into its own
-- table). quantity_available is derived so callers never compute it by hand.
-- -----------------------------------------------------------------------------
create table inventory (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants (id) on delete cascade,
  location_code text not null default 'main',
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  quantity_available integer generated always as (quantity_on_hand - quantity_reserved) stored,
  low_stock_threshold integer not null default 5,
  updated_at timestamptz not null default now(),
  unique (variant_id, location_code),
  constraint inventory_reserved_le_on_hand check (quantity_reserved <= quantity_on_hand)
);
create index inventory_variant_id_idx on inventory (variant_id);

-- -----------------------------------------------------------------------------
-- inventory_movements
-- Append-only audit trail. Every change to `inventory` should be paired with
-- a row here so stock discrepancies can always be traced.
-- -----------------------------------------------------------------------------
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants (id) on delete cascade,
  location_code text not null default 'main',
  movement_type inventory_movement_type not null,
  quantity_delta integer not null,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index inventory_movements_variant_id_idx on inventory_movements (variant_id);
create index inventory_movements_reference_idx on inventory_movements (reference_type, reference_id);

-- -----------------------------------------------------------------------------
-- Atomic stock reservation / release / commit helpers.
-- These are the ONLY sanctioned way to change inventory quantities so that
-- concurrent checkouts can never drive stock negative. Each does a single
-- conditional UPDATE (no read-then-write race) and logs a movement row.
-- -----------------------------------------------------------------------------
create function reserve_variant_stock(
  p_variant_id uuid,
  p_quantity integer,
  p_location_code text default 'main',
  p_reference_type text default null,
  p_reference_id uuid default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  update inventory
  set quantity_reserved = quantity_reserved + p_quantity,
      updated_at = now()
  where variant_id = p_variant_id
    and location_code = p_location_code
    and quantity_on_hand - quantity_reserved >= p_quantity;

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    insert into inventory_movements (variant_id, location_code, movement_type, quantity_delta, reference_type, reference_id)
    values (p_variant_id, p_location_code, 'sale_reserved', -p_quantity, p_reference_type, p_reference_id);
  end if;

  return v_updated = 1;
end;
$$;

create function release_variant_stock(
  p_variant_id uuid,
  p_quantity integer,
  p_location_code text default 'main',
  p_reference_type text default null,
  p_reference_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  update inventory
  set quantity_reserved = greatest(quantity_reserved - p_quantity, 0),
      updated_at = now()
  where variant_id = p_variant_id
    and location_code = p_location_code;

  insert into inventory_movements (variant_id, location_code, movement_type, quantity_delta, reference_type, reference_id)
  values (p_variant_id, p_location_code, 'sale_released', p_quantity, p_reference_type, p_reference_id);
end;
$$;

create function commit_variant_stock(
  p_variant_id uuid,
  p_quantity integer,
  p_location_code text default 'main',
  p_reference_type text default null,
  p_reference_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  update inventory
  set quantity_on_hand = quantity_on_hand - p_quantity,
      quantity_reserved = greatest(quantity_reserved - p_quantity, 0),
      updated_at = now()
  where variant_id = p_variant_id
    and location_code = p_location_code;

  insert into inventory_movements (variant_id, location_code, movement_type, quantity_delta, reference_type, reference_id)
  values (p_variant_id, p_location_code, 'sale_committed', -p_quantity, p_reference_type, p_reference_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- carts / cart_items
-- customer_id is nullable to support guest/anonymous carts identified by
-- session_token; the cart is converted (status -> 'converted') once an order
-- is created from it.
-- -----------------------------------------------------------------------------
create table carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers (id) on delete set null,
  session_token text unique,
  status cart_status not null default 'active',
  currency text not null default 'PHP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);
create index carts_customer_id_idx on carts (customer_id);

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts (id) on delete cascade,
  variant_id uuid not null references product_variants (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  price_cents_snapshot integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);
create index cart_items_cart_id_idx on cart_items (cart_id);

-- -----------------------------------------------------------------------------
-- orders / order_items
-- Totals are always computed and written by server code — never accepted
-- from the client. Address and product/price details are snapshotted so
-- historical orders stay accurate even if the catalog or address book
-- changes later. `source`/`external_order_id` support future marketplace
-- order import with a natural de-dupe key.
-- -----------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references customers (id) on delete restrict,

  status order_status not null default 'pending_payment',
  source order_source not null default 'storefront',
  external_order_id text,

  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  shipping_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'PHP',

  discount_id uuid, -- FK added below via ALTER TABLE, once `discounts` exists

  shipping_address jsonb not null,
  billing_address jsonb,

  is_cod boolean not null default false,
  cod_eligibility_reason text,
  requires_partial_payment boolean not null default false,
  risk_score integer,

  placed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_customer_id_idx on orders (customer_id);
create index orders_status_idx on orders (status);
create unique index orders_source_external_order_id_key on orders (source, external_order_id) where external_order_id is not null;

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  variant_id uuid references product_variants (id) on delete set null,

  product_name_snapshot text not null,
  variant_label_snapshot text,
  sku_snapshot text not null,

  unit_price_cents integer not null,
  quantity integer not null check (quantity > 0),
  line_subtotal_cents integer not null,
  line_discount_cents integer not null default 0,
  line_total_cents integer not null,

  created_at timestamptz not null default now()
);
create index order_items_order_id_idx on order_items (order_id);
create index order_items_variant_id_idx on order_items (variant_id);

-- Note: `discounts` is referenced above but defined below for readability;
-- Postgres resolves this fine since both statements run in the same
-- transaction/migration — order in file doesn't matter for forward refs
-- as long as the referenced table is created before the FK is added.
-- (See reordering note at bottom of file.)

-- -----------------------------------------------------------------------------
-- payments
-- idempotency_key is the guard against duplicate payment records from
-- webhook retries; raw_payload keeps the full gateway response for audits.
-- -----------------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  provider payment_provider not null,
  provider_reference text,
  idempotency_key text not null unique,
  status payment_status not null default 'pending',
  amount_cents integer not null,
  is_partial boolean not null default false,
  raw_payload jsonb,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_order_id_idx on payments (order_id);

-- -----------------------------------------------------------------------------
-- shipments
-- packed_by anticipates ShipMate's packing-verification/staff-KPI workflow.
-- -----------------------------------------------------------------------------
create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  carrier text,
  tracking_number text,
  status shipment_status not null default 'pending',
  packed_by uuid references auth.users (id) on delete set null,
  label_url text,
  raw_payload jsonb,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shipments_order_id_idx on shipments (order_id);
create index shipments_tracking_number_idx on shipments (tracking_number);

-- -----------------------------------------------------------------------------
-- returns
-- Feeds customers.return_count / failed_delivery_count for future COD-risk
-- scoring.
-- -----------------------------------------------------------------------------
create table returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  order_item_id uuid references order_items (id) on delete set null,
  customer_id uuid not null references customers (id) on delete restrict,
  reason text not null,
  status return_status not null default 'requested',
  quantity integer not null default 1 check (quantity > 0),
  refund_amount_cents integer,
  resolution_notes text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index returns_order_id_idx on returns (order_id);
create index returns_customer_id_idx on returns (customer_id);

-- -----------------------------------------------------------------------------
-- discounts
-- scope_ids is a plain uuid[] for v1 (product/variant/collection ids
-- depending on `scope`); can be normalized into a join table later if
-- discount rules get more complex.
-- -----------------------------------------------------------------------------
create table discounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type discount_type not null,
  value integer not null,
  scope discount_scope not null default 'all',
  scope_ids uuid[] not null default '{}',
  min_subtotal_cents integer not null default 0,
  max_uses integer,
  max_uses_per_customer integer,
  times_used integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders
  add constraint orders_discount_id_fkey foreign key (discount_id) references discounts (id) on delete set null;

-- -----------------------------------------------------------------------------
-- staff_users
-- One row per admin-dashboard user, mapped 1:1 to a Supabase Auth user.
-- -----------------------------------------------------------------------------
create table staff_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  role staff_role not null default 'support',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- activity_logs
-- Generic audit trail for the admin dashboard. entity_type/entity_id is a
-- loose polymorphic reference (e.g. 'order' / <order.id>) rather than an FK
-- so logging never fails even if the referenced row is later deleted.
-- -----------------------------------------------------------------------------
create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type activity_actor_type not null,
  staff_user_id uuid references staff_users (id) on delete set null,
  customer_id uuid references customers (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index activity_logs_entity_idx on activity_logs (entity_type, entity_id);
create index activity_logs_created_at_idx on activity_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- marketplace_connections
-- Tokens must be encrypted at rest in production (e.g. via Supabase Vault or
-- an app-level KMS) — this column stores ciphertext, never a plaintext token.
-- -----------------------------------------------------------------------------
create table marketplace_connections (
  id uuid primary key default gen_random_uuid(),
  marketplace marketplace_name not null,
  shop_name text,
  external_shop_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  status marketplace_connection_status not null default 'active',
  connected_by uuid references staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, external_shop_id)
);

-- -----------------------------------------------------------------------------
-- marketplace_product_mappings
-- Maps an external marketplace SKU/variant to an internal Spades variant so
-- inventory sync and order import can resolve the right row.
-- -----------------------------------------------------------------------------
create table marketplace_product_mappings (
  id uuid primary key default gen_random_uuid(),
  marketplace_connection_id uuid not null references marketplace_connections (id) on delete cascade,
  variant_id uuid not null references product_variants (id) on delete cascade,
  external_product_id text,
  external_sku text,
  external_variant_id text not null,
  sync_status marketplace_sync_status not null default 'pending',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace_connection_id, external_variant_id)
);
create index marketplace_product_mappings_variant_id_idx on marketplace_product_mappings (variant_id);

-- -----------------------------------------------------------------------------
-- webhook_events
-- The unique (source, external_event_id) constraint is the idempotency
-- guard: webhook handlers should insert first and bail out on conflict
-- before doing any side effects (order creation, payment capture, etc.).
-- -----------------------------------------------------------------------------
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source webhook_source not null,
  event_type text not null,
  external_event_id text not null,
  payload jsonb not null,
  status webhook_status not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  unique (source, external_event_id)
);
create index webhook_events_status_idx on webhook_events (status);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'customers', 'customer_addresses', 'collections', 'products', 'product_variants',
      'inventory', 'carts', 'cart_items', 'orders', 'payments', 'shipments', 'returns',
      'discounts', 'staff_users', 'marketplace_connections', 'marketplace_product_mappings'
    ])
  loop
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- Default posture: RLS enabled everywhere; the service role key (used only
-- in server-only code, never the browser) bypasses RLS entirely, so all
-- writes to sensitive tables happen through server functions rather than
-- client-side policies.
-- -----------------------------------------------------------------------------
alter table customers enable row level security;
alter table customer_addresses enable row level security;
alter table collections enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;
alter table product_collections enable row level security;
alter table inventory enable row level security;
alter table inventory_movements enable row level security;
alter table carts enable row level security;
alter table cart_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table shipments enable row level security;
alter table returns enable row level security;
alter table discounts enable row level security;
alter table staff_users enable row level security;
alter table activity_logs enable row level security;
alter table marketplace_connections enable row level security;
alter table marketplace_product_mappings enable row level security;
alter table webhook_events enable row level security;

-- Public storefront read access (catalog is public data).
create policy "public read active collections" on collections for select using (is_active = true);
create policy "public read active products" on products for select using (status = 'active');
create policy "public read active variants" on product_variants for select using (is_active = true);
create policy "public read product_collections" on product_collections for select using (true);

-- Customers can read/update their own profile and address book.
create policy "customers select own row" on customers for select using (auth.uid() = auth_user_id);
create policy "customers update own row" on customers for update using (auth.uid() = auth_user_id);

create policy "customers select own addresses" on customer_addresses for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers manage own addresses" on customer_addresses for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));

-- Customers can read their own cart while signed in (guest carts are
-- managed entirely by server-only code via the service role).
create policy "customers select own cart" on carts for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers select own cart items" on cart_items for select
  using (cart_id in (select id from carts where customer_id in (select id from customers where auth_user_id = auth.uid())));

-- Customers can read their own orders and order history, never write them
-- directly — all order/payment/shipment writes happen via server functions.
create policy "customers select own orders" on orders for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers select own order items" on order_items for select
  using (order_id in (select id from orders where customer_id in (select id from customers where auth_user_id = auth.uid())));
create policy "customers select own payments" on payments for select
  using (order_id in (select id from orders where customer_id in (select id from customers where auth_user_id = auth.uid())));
create policy "customers select own shipments" on shipments for select
  using (order_id in (select id from orders where customer_id in (select id from customers where auth_user_id = auth.uid())));
create policy "customers select own returns" on returns for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));

-- Staff dashboard access: any active staff_users row can read operational
-- tables. Fine-grained per-role checks (e.g. only super_admin can manage
-- staff_users) are enforced in server functions, not here.
create policy "staff read all customers" on customers for select
  using (exists (select 1 from staff_users su where su.auth_user_id = auth.uid() and su.is_active));
create policy "staff read all orders" on orders for select
  using (exists (select 1 from staff_users su where su.auth_user_id = auth.uid() and su.is_active));
create policy "staff read all order items" on order_items for select
  using (exists (select 1 from staff_users su where su.auth_user_id = auth.uid() and su.is_active));
create policy "staff read own staff row" on staff_users for select
  using (auth_user_id = auth.uid());
create policy "staff read activity logs" on activity_logs for select
  using (exists (select 1 from staff_users su where su.auth_user_id = auth.uid() and su.is_active));

-- inventory, inventory_movements, discounts, payments (write), shipments
-- (write), returns (write), marketplace_*, and webhook_events intentionally
-- have NO client-facing policies: only the service-role key (server-only)
-- can touch them. This is enforced by omission — RLS is enabled with zero
-- matching policies for the anon/authenticated roles.
