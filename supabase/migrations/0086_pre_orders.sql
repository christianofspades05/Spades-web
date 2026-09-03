-- Pre-orders: staff mark a variant as available for pre-order with an
-- "upcoming quantity" that doesn't exist as real stock yet. Deliberately
-- NOT modeled as a second `inventory` row (location_code='pre_order') even
-- though that table already supports multiple locations per variant —
-- `inventory` is joined/summed/`.at(0)`'d unfiltered by location in a lot
-- of existing storefront/admin code (product pricing, listings, rule
-- matching, the Inventory admin page...), and adding a second row there
-- would silently corrupt every one of those call sites. Keeping pre-order
-- quantity on its own columns here means none of that existing code needs
-- to change at all — it only ever sees the same `inventory` rows it always
-- has.
alter table product_variants
  add column is_pre_order boolean not null default false,
  add column pre_order_arrival_note text,
  add column pre_order_quantity integer not null default 0
    check (pre_order_quantity >= 0),
  add column pre_order_reserved integer not null default 0
    check (pre_order_reserved >= 0),
  add constraint product_variants_pre_order_reserved_le_quantity
    check (pre_order_reserved <= pre_order_quantity);

-- Generated the same way inventory.quantity_available already is.
alter table product_variants
  add column pre_order_available integer
    generated always as (pre_order_quantity - pre_order_reserved) stored;

comment on column product_variants.is_pre_order is
  'Whether this variant can currently be sold as a pre-order — independent of whether it has any real inventory. Managed from the dedicated /admin/pre-orders page, not the regular variant editor.';
comment on column product_variants.pre_order_quantity is
  'Units expected to arrive, not yet real stock. Decremented (and inventory.quantity_on_hand incremented on the ''main'' location) via receivePreOrderStock when they actually arrive.';
comment on column product_variants.pre_order_reserved is
  'Units already claimed by placed, unarrived pre-orders — mirrors inventory.quantity_reserved''s role but scoped to pre-order stock only, via reserve_pre_order_stock/release_pre_order_stock.';

-- A pre-order line is snapshotted the same way product_name_snapshot/
-- sku_snapshot already are — a variant's is_pre_order flag can change
-- after the order is placed, the order line remembers what it was.
alter table order_items
  add column is_pre_order boolean not null default false;

-- Denormalized for cheap admin-list badges (avoids joining order_items just
-- to know if an order needs the pre-order banner) and to gate fulfillment:
-- staff hold the whole order until every pre-order line's stock has
-- arrived (see receivePreOrderStock), rather than introducing a new
-- order_status value into the existing ALLOWED_TRANSITIONS pipeline.
alter table orders
  add column has_pre_order_items boolean not null default false,
  add column pre_order_ready_at timestamptz;

comment on column orders.pre_order_ready_at is
  'Set once every pre-order line on this order has had its stock arrive and its reservation moved onto the real (main) inventory location — null means "still waiting," which the admin order page uses to warn staff off fulfilling early.';

-- Mirrors reserve_variant_stock/release_variant_stock exactly (same atomic
-- conditional-UPDATE shape, same security definer), just against the new
-- pre_order_quantity/pre_order_reserved columns instead of the inventory
-- table — see that migration (0001_init_schema.sql) for the pattern this
-- follows.
create or replace function reserve_pre_order_stock(
  p_variant_id uuid,
  p_quantity integer
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

  update product_variants
  set pre_order_reserved = pre_order_reserved + p_quantity
  where id = p_variant_id
    and pre_order_quantity - pre_order_reserved >= p_quantity;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function release_pre_order_stock(
  p_variant_id uuid,
  p_quantity integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  update product_variants
  set pre_order_reserved = greatest(0, pre_order_reserved - p_quantity)
  where id = p_variant_id;
end;
$$;
