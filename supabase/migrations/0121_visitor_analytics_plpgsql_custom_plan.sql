-- Companion to 0120 — the new covering indexes alone weren't enough.
-- language sql function bodies are planned once as a fully generic plan
-- (parameter values are never substituted in for planning, unlike PL/pgSQL
-- or an extended-protocol PREPARE/EXECUTE), so get_visitor_totals and
-- get_visitor_countries kept picking a plan that ignored 0120's indexes
-- even after they existed — confirmed live: 3.1s / 5.8s as `language sql`
-- vs. 720ms / 1.0s after converting to plpgsql (which gets PL/pgSQL's
-- custom-plan-for-the-first-5-executions behavior, planned against the
-- real parameter values). get_visitor_bucket_counts (already plpgsql as of
-- a prior same-day change) and get_visitor_cities (not on this page's hot
-- path, converted anyway so it doesn't become the next version of this
-- same bug) follow the same pattern.
create or replace function get_visitor_totals(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(unique_visitors bigint, page_views bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select count(distinct visitor_id), count(*)
    from storefront_visits
    where event_type = 'page_view'
      and created_at >= p_from
      and created_at <= p_to
      and (p_brand is null or brand = p_brand);
end;
$$;

create or replace function get_visitor_countries(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
) returns table(country text, unique_visitors bigint, page_views bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select storefront_visits.country, count(distinct visitor_id), count(*)
    from storefront_visits
    where event_type = 'page_view'
      and created_at >= p_from
      and created_at <= p_to
      and (p_brand is null or brand = p_brand)
    group by storefront_visits.country;
end;
$$;

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
      and city is not null
      and city <> ''
    group by storefront_visits.city, storefront_visits.country;
end;
$$;

-- get_visitor_bucket_counts: already converted to plpgsql earlier today
-- (see optimize_visitor_bucket_counts_local_date, applied directly — this
-- restates it here so schema history / a fresh database matches
-- production exactly).
create or replace function get_visitor_bucket_counts(
  p_from timestamptz,
  p_to timestamptz,
  p_hourly boolean,
  p_brand text default null
) returns table(bucket_key text, unique_visitors bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_hourly then
    return query
      select
        to_char(storefront_visits.created_at + interval '8 hours', 'YYYY-MM-DD"T"HH24'),
        count(distinct storefront_visits.visitor_id)
      from storefront_visits
      where event_type = 'page_view'
        and created_at >= p_from
        and created_at <= p_to
        and (p_brand is null or brand = p_brand)
      group by 1;
  else
    return query
      select
        to_char((storefront_visits.created_at at time zone interval '+08:00')::date, 'YYYY-MM-DD'),
        count(distinct storefront_visits.visitor_id)
      from storefront_visits
      where event_type = 'page_view'
        and created_at >= p_from
        and created_at <= p_to
        and (p_brand is null or brand = p_brand)
      group by (storefront_visits.created_at at time zone interval '+08:00')::date;
  end if;
end;
$$;

revoke execute on function get_visitor_totals(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function get_visitor_countries(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function get_visitor_cities(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function get_visitor_bucket_counts(timestamptz, timestamptz, boolean, text) from public, anon, authenticated;
