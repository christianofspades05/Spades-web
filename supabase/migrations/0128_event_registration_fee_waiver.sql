-- Affiliates (active creators) and website admins (active staff_users)
-- register for community events for free — on the public storefront form
-- and via the admin "Add registrant" form alike. Decided inside
-- reserve_event_slot, never from a client-supplied flag: the function
-- matches the registrant's email (case-insensitive, same as the dedupe
-- check below) against creators.email and the staff member's login email
-- in auth.users, and records why the fee was waived in fee_waiver so the
-- admin registrant list can label it.
alter table event_registrations
  add column if not exists fee_waiver text
    check (fee_waiver in ('affiliate', 'staff'));

create or replace function reserve_event_slot(
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
  v_waiver text;
  v_fee integer;
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

    if exists (
      select 1 from staff_users s
      join auth.users u on u.id = s.auth_user_id
      where s.is_active and lower(u.email) = lower(p_email)
    ) then
      v_waiver := 'staff';
    elsif exists (
      select 1 from creators c
      where c.is_active and lower(c.email) = lower(p_email)
    ) then
      v_waiver := 'affiliate';
    end if;
  end if;

  v_fee := case when v_waiver is not null then 0 else ev.fee_cents end;

  insert into event_registrations (
    event_id, full_name, age, email, phone, fee_cents, status, confirmed_at,
    fee_waiver
  )
  values (
    p_event_id, p_full_name, p_age, p_email, p_phone, v_fee,
    case when v_fee = 0 then 'confirmed' else 'pending' end,
    case when v_fee = 0 then now() else null end,
    -- Only meaningful when it actually waived something (a free event is
    -- just free, whoever registers).
    case when ev.fee_cents > 0 then v_waiver else null end
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
