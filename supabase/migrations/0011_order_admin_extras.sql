-- Admin order management: courier tracking link, and a way to reverse a
-- committed sale (on_hand already decremented) when a paid order is
-- cancelled with "restock inventory" checked. release_variant_stock only
-- undoes a *reservation* (quantity_reserved), not a commit, so it can't be
-- reused here.

alter table shipments add column tracking_url text;

create function restock_variant_stock(
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
  set quantity_on_hand = quantity_on_hand + p_quantity,
      updated_at = now()
  where variant_id = p_variant_id
    and location_code = p_location_code;

  insert into inventory_movements (variant_id, location_code, movement_type, quantity_delta, reference_type, reference_id)
  values (p_variant_id, p_location_code, 'return_in', p_quantity, p_reference_type, p_reference_id);
end;
$$;
