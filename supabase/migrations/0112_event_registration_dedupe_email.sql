-- Prevents the same email from holding two active (pending/confirmed)
-- slots on the same event — confirmed live: "joankenardb@gmail.com"
-- registered twice 50 seconds apart for Spades Court Side 18+ Basketball,
-- taking 2 of its 30 slots as one person. Checked inside the function,
-- after the same `for update` lock on community_events that already
-- serializes concurrent reserve_event_slot calls for this event (see
-- 0106_community_events.sql's own comment on that lock), so two
-- near-simultaneous submits with the same email can't both slip past the
-- check the way two separate app-layer queries could race. Case-insensitive
-- (lower()) for the same reason customer email lookups are — people don't
-- reliably match their own casing between visits. A null email (the
-- admin-only path, see 0109_event_registration_optional_email.sql) has
-- nothing to dedupe against, so it's left unchecked, same as before.
drop function reserve_event_slot(uuid, text, integer, text, text);

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
  existing_id uuid;
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

  if p_email is not null then
    select id into existing_id from event_registrations
    where event_id = p_event_id
      and status in ('pending', 'confirmed')
      and lower(email) = lower(p_email)
    limit 1;
    if existing_id is not null then
      raise exception 'This email is already registered for this event';
    end if;
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
