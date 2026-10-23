-- Staff-initiated removal of a registrant (duplicate signup, no-show
-- cleanup, a walk-in added by mistake), as opposed to release_event_slot
-- (0106_community_events.sql), which only ever fires for a 'pending'
-- registration on genuine payment expiry/failure and deliberately no-ops
-- on 'confirmed' so a late PAID webhook can't be undercut by an unrelated
-- cleanup pass. This one is explicit and staff-only (gated by requireStaff
-- in the calling server function, same as addEventRegistration), and
-- removes a registration regardless of status — confirmed or pending —
-- always giving the slot back to the cap, since staff asked for it by name
-- rather than a background process racing a webhook. Reuses the existing
-- 'released' status/released_at columns rather than hard-deleting, same
-- reasoning as release_event_slot: keeps the row around for the event's
-- own history instead of losing who registered and was later removed.
create function remove_event_registration(p_registration_id uuid)
returns event_registrations
language plpgsql security definer set search_path = public as $$
declare reg event_registrations%rowtype;
begin
  select * into reg from event_registrations
  where id = p_registration_id for update;
  if reg.id is null then
    raise exception 'Registration not found';
  end if;
  if reg.status = 'released' then
    return reg;
  end if;

  update event_registrations
  set status = 'released', released_at = now()
  where id = p_registration_id
  returning * into reg;

  update community_events
  set slots_reserved = greatest(slots_reserved - 1, 0), updated_at = now()
  where id = reg.event_id;

  return reg;
end;
$$;
revoke all on function remove_event_registration(uuid)
  from public, anon, authenticated;
grant execute on function remove_event_registration(uuid) to service_role;
