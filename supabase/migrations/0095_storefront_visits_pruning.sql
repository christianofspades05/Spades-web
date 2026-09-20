-- storefront_visits gets an unconditional insert on every storefront page
-- view (see src/lib/analytics/../server/analytics/track.ts) with no cap, so
-- it grows without bound. The admin Home dashboard's date-range picker
-- (src/components/admin/DateRangePicker.tsx) includes a "Custom" range whose
-- from/to date inputs have no minimum — an admin can legitimately query any
-- past date, so this migration does NOT delete anything automatically.
-- Instead it ships a callable function so pruning is a deliberate, explicit
-- action taken once the actual table size/age has been checked in the
-- Supabase dashboard and a safe retention window has been chosen, not a
-- blind delete run against data nobody has looked at yet.
create or replace function prune_storefront_visits(retain_days integer)
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  if retain_days < 90 then
    raise exception 'retain_days must be at least 90 — refusing to prune data that recent';
  end if;

  delete from storefront_visits
  where created_at < now() - (retain_days || ' days')::interval;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function prune_storefront_visits(integer) is
  'Deletes storefront_visits rows older than retain_days. Call manually '
  '(e.g. select prune_storefront_visits(365)) after confirming in the '
  'Supabase dashboard that nothing currently relies on data past that '
  'cutoff — see 0093''s migration comment for why this is not automatic.';
