-- Community Events (Spades-only storefront feature, "Community" in admin
-- under Marketing): staff create events with a slot cap, an optional
-- banner image, and an optional Xendit fee; guests register with full
-- name + age (+ email for the receipt/confirmation), no account needed.
--
-- Mirrors checkout_reservations / mint_checkout_order for payment safety:
-- a paid event's registration is 'pending' until Xendit confirms PAID,
-- soft-released (not deleted) on genuine expiry/failure so a late-arriving
-- PAID webhook can still recover it — see release-reservation.ts's own
-- doc comment for why hard-deleting here caused real money-losing bugs
-- before. A free event (fee_cents = 0) skips payment and is 'confirmed'
-- immediately.
create table community_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  location_name text not null,
  location_map_url text,
  image_url text,
  starts_at timestamptz not null,
  total_slots integer not null check (total_slots > 0),
  -- Pending + confirmed registrations currently holding a slot — a plain
  -- counter (not a live count() of event_registrations) so capacity checks
  -- in reserve_event_slot below are a single locked-row read, not a
  -- second table scan under the same lock.
  slots_reserved integer not null default 0,
  fee_cents integer not null default 0 check (fee_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index community_events_starts_at_idx on community_events (starts_at);

create table event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references community_events (id) on delete cascade,
  full_name text not null,
  age integer not null check (age >= 0 and age <= 130),
  email text not null,
  phone text,
  -- Snapshotted from community_events.fee_cents at registration time by
  -- reserve_event_slot (never trusted from the client) — survives the
  -- event's own fee changing later.
  fee_cents integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'released')),
  xendit_invoice_id text,
  confirmed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index event_registrations_event_id_idx on event_registrations (event_id);
create index event_registrations_status_idx on event_registrations (status);

alter table community_events enable row level security;
alter table event_registrations enable row level security;

-- Same shape as every other public-facing catalog table (collections,
-- products, ...) — anonymous storefront reads only see active events; all
-- admin writes go through the service-role client, which bypasses RLS.
create policy "public read active events"
  on community_events for select using (is_active = true);

-- event_registrations has no public read policy at all — a guest can
-- create one (via the service-role client inside registerForEvent, never
-- directly from the browser) but never list anyone's registrations,
-- including their own; staff view them through the admin panel only.

-- Atomically locks the event row, checks it's active and has room, inserts
-- the registration (confirmed immediately if free, pending otherwise), and
-- bumps slots_reserved — all under one row lock so two guests racing for
-- the last slot can't both succeed, same discipline as
-- reserve_variant_stock (0001_init_schema.sql).
create function reserve_event_slot(
  p_event_id uuid,
  p_full_name text,
  p_age integer,
  p_email text,
  p_phone text
) returns event_registrations
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

  return reg;
end;
$$;
revoke all on function reserve_event_slot(uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function reserve_event_slot(uuid, text, integer, text, text)
  to service_role;

-- Confirms a pending registration on PAID — idempotent (a retried webhook
-- or a race with the stale-cleanup cron just returns the already-confirmed
-- row). Re-increments slots_reserved only when recovering a PREVIOUSLY
-- released registration (a late PAID arriving after the stale-cleanup
-- cron already gave the slot back) — a first-time pending->confirmed
-- transition doesn't touch the counter, since reserve_event_slot already
-- counted it at creation time.
create function mint_event_registration(p_registration_id uuid)
returns event_registrations
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
    return reg;
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

  return reg;
end;
$$;
revoke all on function mint_event_registration(uuid)
  from public, anon, authenticated;
grant execute on function mint_event_registration(uuid) to service_role;

-- Gives back a pending registration's slot on genuine expiry/failure —
-- soft-delete only (released_at), never deletes the row, so a late PAID
-- webhook can still recover it via mint_event_registration above.
-- Idempotent: a non-pending registration (already confirmed or already
-- released) is left untouched.
create function release_event_slot(p_registration_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare reg event_registrations%rowtype;
begin
  select * into reg from event_registrations
  where id = p_registration_id for update;
  if reg.id is null then
    raise exception 'Registration not found';
  end if;
  if reg.status <> 'pending' then
    return;
  end if;

  update event_registrations
  set status = 'released', released_at = now()
  where id = p_registration_id;

  update community_events
  set slots_reserved = greatest(slots_reserved - 1, 0), updated_at = now()
  where id = reg.event_id;
end;
$$;
revoke all on function release_event_slot(uuid)
  from public, anon, authenticated;
grant execute on function release_event_slot(uuid) to service_role;

-- Banner image uploads — same pattern as storefront-sections
-- (0031_storefront_sections.sql): uploads always go through an admin
-- server function using the service-role client, which bypasses storage
-- RLS, so a public bucket with no RLS policies is enough for the
-- resulting URLs to be viewable on the storefront.
insert into storage.buckets (id, name, public)
values ('community-events', 'community-events', true)
on conflict (id) do nothing;
