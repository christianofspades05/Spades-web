-- -----------------------------------------------------------------------------
-- Follow-up to 0133. Two more admin queries still timed out on "This month":
--
-- 1. get_visitor_countries (admin Home's Conversion Rate by Country) still
--    count-distincted every raw page view. storefront_visitor_days now
--    carries country too (one row per brand, day, visitor, country), and
--    get_visitor_countries reads whole days from it the same way
--    get_visitor_totals does. A visitor seen from two countries on one day
--    is two rows; the totals/bucket functions count-distinct visitor_id, so
--    they're unaffected.
--
-- 2. checkout_funnel_daily fetched ~73k checkout events scattered across a
--    1.5GB table (5.7s cold). A partial covering index holding only checkout
--    events (with visitor_id and metadata) lets it read them in one go.
-- -----------------------------------------------------------------------------

-- Hold off concurrent page-view inserts while the rollup is rebuilt, so
-- nothing is missed or double counted.
lock table storefront_visits in share row exclusive mode;

truncate storefront_visitor_days;

alter table storefront_visitor_days
  add column country text not null default '';

alter table storefront_visitor_days
  drop constraint storefront_visitor_days_pkey;

alter table storefront_visitor_days
  add primary key (brand, day, visitor_id, country);

create or replace function track_storefront_visitor_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into storefront_visitor_days (brand, day, visitor_id, country, page_views)
  values (
    new.brand,
    (new.created_at at time zone 'Asia/Manila')::date,
    new.visitor_id,
    coalesce(new.country, ''),
    1
  )
  on conflict (brand, day, visitor_id, country)
  do update set page_views = storefront_visitor_days.page_views + 1;
  return null;
end;
$$;

insert into storefront_visitor_days (brand, day, visitor_id, country, page_views)
select
  brand,
  (created_at at time zone 'Asia/Manila')::date,
  visitor_id,
  coalesce(country, ''),
  count(*)
from storefront_visits
where event_type = 'page_view'
group by 1, 2, 3, 4;

create or replace function get_visitor_countries(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
)
returns table (country text, unique_visitors bigint, page_views bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_first date;
  v_last date;
  v_head_end timestamptz;
  v_tail_start timestamptz;
begin
  select f.first_day, f.last_day into v_first, v_last
  from visitor_full_days(p_from, p_to) f;

  if v_first > v_last then
    return query
      select storefront_visits.country, count(distinct visitor_id), count(*)
      from storefront_visits
      where event_type = 'page_view'
        and created_at >= p_from
        and created_at <= p_to
        and (p_brand is null or brand = p_brand)
      group by storefront_visits.country;
    return;
  end if;

  v_head_end := v_first::timestamp at time zone 'Asia/Manila';
  v_tail_start := (v_last + 1)::timestamp at time zone 'Asia/Manila';

  return query
    select nullif(x.country, ''), count(distinct x.visitor_id), sum(x.pv)::bigint
    from (
      select d.country, d.visitor_id, d.page_views::bigint as pv
      from storefront_visitor_days d
      where d.day between v_first and v_last
        and (p_brand is null or d.brand = p_brand)
      union all
      select coalesce(v.country, ''), v.visitor_id, 1::bigint
      from storefront_visits v
      where v.event_type = 'page_view'
        and (
          (v.created_at >= p_from and v.created_at < v_head_end)
          or (v.created_at >= v_tail_start and v.created_at <= p_to)
        )
        and (p_brand is null or v.brand = p_brand)
    ) x
    group by x.country;
end;
$$;

revoke execute on function get_visitor_countries(timestamptz, timestamptz, text) from public, anon, authenticated;

create index storefront_visits_checkout_events_idx
  on storefront_visits (event_type, created_at)
  include (visitor_id, metadata)
  where event_type in (
    'checkout_start',
    'checkout_view',
    'checkout_email_entered',
    'checkout_address_entered',
    'checkout_shipping_shown',
    'checkout_payment_selected',
    'checkout_place_order_clicked',
    'checkout_order_success'
  );
