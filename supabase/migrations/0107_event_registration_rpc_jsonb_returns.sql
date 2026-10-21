-- Match mint_checkout_order's established convention (returns jsonb, not
-- a composite table type): PostgREST wraps an RPC result in a JSON array
-- for any function returning a table/composite type — even a non-setof
-- one — but returns a jsonb-returning function's result as the bare
-- value. Declaring these as jsonb means every caller gets the object
-- directly, matching mint_checkout_order (0091_creator_management.sql)
-- rather than needing a supabase-js .single() unwrap on every call.
drop function reserve_event_slot(uuid, text, integer, text, text);
drop function mint_event_registration(uuid);

create function reserve_event_slot(
  p_event_id uuid,
  p_full_name text,
  p_age integer,
  p_email text,
  p_phone text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev community_events%rowtype;
  reg event_registrations%rowtype;
begin
  select * into ev from community_events where id = p_event_id for update;
  if ev.id is null then
    raise exception 'Event not found';
  end if;
  if not ev.is_active then
    raise exception 'This event is no longer accepting registrations';
  end if;
  if ev.slots_reserved >= ev.total_slots then
    raise exception 'This event is fully booked';
  end if;

  insert into event_registrations (
    event_id, full_name, age, email, phone, fee_cents, status, confirmed_at
  )
  values (
    p_event_id, p_full_name, p_age, p_email, p_phone, ev.fee_cents,
    case when ev.fee_cents = 0 then 'confirmed' else 'pending' end,
    case when ev.fee_cents = 0 then now() else null end
  )
  returning * into reg;

  update community_events
  set slots_reserved = slots_reserved + 1, updated_at = now()
  where id = p_event_id;

  return to_jsonb(reg);
end;
$$;
revoke all on function reserve_event_slot(uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function reserve_event_slot(uuid, text, integer, text, text)
  to service_role;

create function mint_event_registration(p_registration_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  reg event_registrations%rowtype;
  was_released boolean;
begin
  select * into reg from event_registrations
  where id = p_registration_id for update;
  if reg.id is null then
    raise exception 'Registration not found';
  end if;
  if reg.status = 'confirmed' then
    return to_jsonb(reg);
  end if;

  was_released := reg.status = 'released';

  update event_registrations
  set status = 'confirmed', confirmed_at = now(), released_at = null
  where id = p_registration_id
  returning * into reg;

  if was_released then
    update community_events
    set slots_reserved = slots_reserved + 1, updated_at = now()
    where id = reg.event_id;
  end if;

  return to_jsonb(reg);
end;
$$;
revoke all on function mint_event_registration(uuid)
  from public, anon, authenticated;
grant execute on function mint_event_registration(uuid) to service_role;
