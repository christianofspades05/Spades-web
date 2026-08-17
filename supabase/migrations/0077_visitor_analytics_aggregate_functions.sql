-- Server-side aggregation for the admin Visitors analytics page. Previously
-- getVisitorAnalytics pulled every matching storefront_visits row into Node
-- (hundreds of thousands of rows, 1000 at a time) just to count/group them
-- in memory — painfully slow at real traffic volume. These push the
-- COUNT(DISTINCT visitor_id)/COUNT(*) aggregation into Postgres instead,
-- returning only the tiny grouped result. storefront_visits already has an
-- (event_type, created_at) index covering the WHERE clause here.

create or replace function get_visitor_totals(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(unique_visitors bigint, page_views bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct visitor_id), count(*)
  from storefront_visits
  where event_type = 'page_view'
    and created_at >= p_from
    and created_at <= p_to
    and (p_brand is null or brand = p_brand)
$$;

create or replace function get_visitor_countries(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(country text, unique_visitors bigint, page_views bigint)
language sql
stable
security definer
set search_path = public
as $$
  select country, count(distinct visitor_id), count(*)
  from storefront_visits
  where event_type = 'page_view'
    and created_at >= p_from
    and created_at <= p_to
    and (p_brand is null or brand = p_brand)
  group by country
$$;

create or replace function get_visitor_cities(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(city text, country text, unique_visitors bigint, page_views bigint)
language sql
stable
security definer
set search_path = public
as $$
  select city, country, count(distinct visitor_id), count(*)
  from storefront_visits
  where event_type = 'page_view'
    and created_at >= p_from
    and created_at <= p_to
    and (p_brand is null or brand = p_brand)
    and city is not null
    and city <> ''
  group by city, country
$$;

-- Only ever called via the server-only service-role client, same pattern as
-- reserve_variant_stock/etc. (see 0039_security_advisor_hardening.sql).
revoke execute on function get_visitor_totals(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function get_visitor_countries(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function get_visitor_cities(timestamptz, timestamptz, text) from public, anon, authenticated;
