-- Addresses Supabase's Security Advisor warnings.

-- -----------------------------------------------------------------------------
-- Function Search Path Mutable
-- Every other function in this codebase that needs a fixed search_path
-- already has one (e.g. handle_new_auth_user, sync_customer_auth_state) —
-- these two were just missed. A function without one is vulnerable to
-- search_path hijacking (a malicious schema earlier in the caller's
-- search_path shadowing an unqualified object reference). Neither function
-- touches anything outside its own trigger row, so this is pure hardening,
-- not a fix for an active bug.
-- -----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function prevent_date_of_birth_change() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth then
    raise exception 'date_of_birth cannot be changed once set';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public/Signed-In Users Can Execute SECURITY DEFINER Function
-- All six are only ever called via the server-only service-role client
-- (getSupabaseAdminClient()) — confirmed by grepping every .rpc() call site
-- in the app, and the trigger functions are never called directly by any
-- role at all (a trigger's own privilege model, not the firing user's
-- EXECUTE grant, governs it). Revoking here removes the ability for the
-- public anon key or any signed-in customer to invoke these directly via
-- PostgREST's /rpc endpoint — service_role is unaffected by these grants,
-- so nothing in the app's own code paths changes.
-- -----------------------------------------------------------------------------
revoke execute on function reserve_variant_stock(uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function release_variant_stock(uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function commit_variant_stock(uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function restock_variant_stock(uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function handle_new_auth_user() from public, anon, authenticated;
revoke execute on function sync_customer_auth_state() from public, anon, authenticated;
