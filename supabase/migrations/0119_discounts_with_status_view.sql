-- Powers server-side status filtering on the admin Discounts list (see
-- src/routes/admin/discounts/index.tsx's computeStatus, which this mirrors
-- exactly). Status depends on now(), so it can't be a generated column
-- (those require immutable expressions) — a view recomputes it per query
-- instead. With 15k+ discounts, filtering has to happen in the query, not
-- just on the current page's 50 rows, for pagination to stay correct.
--
-- Admin-only: queried exclusively via the service-role client
-- (getSupabaseAdminClient), which bypasses RLS/grants entirely, so this
-- intentionally has no security_invoker clause and no grant to
-- anon/authenticated, same as admin_product_listing (0082).
create or replace view discounts_with_status as
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
