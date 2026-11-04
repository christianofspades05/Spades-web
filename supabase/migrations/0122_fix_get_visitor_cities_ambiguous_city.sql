-- Fixes "column reference \"city\" is ambiguous" on the admin Visitors page
-- (any range — introduced by 0121_visitor_analytics_plpgsql_custom_plan.sql
-- when get_visitor_cities was converted to plpgsql). Converting a SQL
-- function to plpgsql makes its `returns table(...)` columns into
-- implicitly-named variables in scope throughout the function body — the
-- SELECT list and GROUP BY were already qualified with `storefront_visits.`,
-- but the WHERE clause's `city is not null and city <> ''` was left
-- unqualified, colliding with the function's own `city` OUT parameter.
create or replace function get_visitor_cities(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(city text, country text, unique_visitors bigint, page_views bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select storefront_visits.city, storefront_visits.country, count(distinct visitor_id), count(*)
    from storefront_visits
    where event_type = 'page_view'
      and created_at >= p_from
      and created_at <= p_to
      and (p_brand is null or brand = p_brand)
      and storefront_visits.city is not null
      and storefront_visits.city <> ''
    group by storefront_visits.city, storefront_visits.country;
end;
$$;

revoke execute on function get_visitor_cities(timestamptz, timestamptz, text) from public, anon, authenticated;
