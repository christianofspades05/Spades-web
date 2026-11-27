-- -----------------------------------------------------------------------------
-- Creator link tracking (https://<store>/?ref=<CODE>).
--
-- Landing with ?ref= sets a 30-day first-party cookie (spades_ref) and logs
-- a storefront_visits row with event_type 'creator_link_visit' and
-- metadata {creator_id} — no PII (src/server/analytics/creator-ref.ts).
--
-- At checkout, an order without a creator code but with a valid ref cookie
-- stores that code in creator_ref_code (orders for COD, checkout_reservations
-- for online payments). The capture trigger below then attributes it to the
-- creator with attribution_type = 'link'. Commission is the same as a code
-- order: per-line rates are snapshotted on order_items at checkout, and
-- reconcile_creator_order (0135) does the rest unchanged.
-- -----------------------------------------------------------------------------

alter table orders add column if not exists creator_ref_code text;
alter table checkout_reservations add column if not exists creator_ref_code text;

-- Same as 0091's version, plus the link fallback when no code snapshot.
create or replace function creator_capture_attribution() returns trigger
language plpgsql security definer set search_path = public as $$
declare snapshot jsonb; ref text; kind text := 'code';
begin
  if new.source <> 'storefront' then return new; end if;
  if new.external_order_id is not null then
    select creator_snapshot, creator_ref_code into snapshot, ref
      from checkout_reservations where id::text = new.external_order_id;
  else
    select jsonb_build_object('creator_id', a.creator_id, 'assignment_id', a.id, 'code', d.code,
      'commission_bps', a.commission_bps, 'hold_days', a.hold_days) into snapshot
      from creator_discount_assignments a join creators c on c.id = a.creator_id
      join discounts d on d.id = a.discount_id
      where a.discount_id = new.discount_id and a.brand = new.brand and a.is_active
        and c.is_active and d.kind = 'code' and new.discount_cents > 0;
  end if;
  ref := coalesce(ref, new.creator_ref_code);
  if snapshot is null and ref is not null then
    select jsonb_build_object('creator_id', a.creator_id, 'assignment_id', a.id, 'code', d.code,
      'commission_bps', a.commission_bps, 'hold_days', a.hold_days) into snapshot
      from creator_discount_assignments a join creators c on c.id = a.creator_id
      join discounts d on d.id = a.discount_id
      where upper(d.code) = upper(ref) and a.brand = new.brand and a.is_active
        and c.is_active and d.kind = 'code'
      limit 1;
    kind := 'link';
  end if;
  if snapshot is not null then
    insert into order_creator_attributions(order_id, creator_id, assignment_id, code_snapshot,
      commission_bps, hold_days, attribution_type)
    values (new.id, (snapshot->>'creator_id')::uuid, (snapshot->>'assignment_id')::uuid,
      snapshot->>'code', (snapshot->>'commission_bps')::integer,
      (snapshot->>'hold_days')::integer, kind);
  end if;
  return new;
end $$;
