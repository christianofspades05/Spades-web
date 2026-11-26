-- -----------------------------------------------------------------------------
-- Free gift deals: once the cart holds at least `min_quantity` eligible
-- items, the customer picks one free item at checkout from the products in
-- `gift_collection_ids` (e.g. Clearance or Essentials). One free item per
-- order. The pick is held on the cart (carts.free_gift_variant_id) and only
-- becomes a ₱0 order line — with its stock reserved like any other line —
-- when the order is placed (see src/server/cart/free-gift.ts and
-- place-order.ts).
-- -----------------------------------------------------------------------------
alter type discount_type add value if not exists 'free_gift';

alter table discounts
  add column gift_collection_ids uuid[] not null default '{}';

alter table carts
  add column free_gift_variant_id uuid
  references product_variants (id) on delete set null;

-- Rebuilt so d.* picks up gift_collection_ids (see 0131 for why).
drop view discounts_with_status;

create view discounts_with_status as
select
  d.*,
  case
    when not d.is_active then 'inactive'
    when d.starts_at is not null and d.starts_at > now() then 'scheduled'
    when (d.ends_at is not null and d.ends_at < now())
      or (d.max_uses is not null and d.times_used >= d.max_uses) then 'expired'
    else 'active'
  end as status
from discounts d;
