-- Server-side aggregation for the admin Product Analytics "Low Visitors"
-- tab — same reasoning as get_visitor_totals/etc. in
-- 0077_visitor_analytics_aggregate_functions.sql: pulling every matching
-- storefront_visits row into Node just to count per product_id doesn't
-- scale, so this pushes the GROUP BY into Postgres instead. Covered by the
-- same (event_type, created_at) index those functions already rely on.
create or replace function get_product_view_counts(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(product_id uuid, view_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select product_id, count(*)
  from storefront_visits
  where event_type = 'product_view'
    and product_id is not null
    and created_at >= p_from
    and created_at <= p_to
    and (p_brand is null or brand = p_brand)
  group by product_id
$$;

-- Only ever called via the server-only service-role client, same pattern as
-- the other get_visitor_* functions.
revoke execute on function get_product_view_counts(timestamptz, timestamptz, text) from public, anon, authenticated;
