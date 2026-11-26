-- -----------------------------------------------------------------------------
-- Daily visitor rollup. storefront_visits passed 2.7M rows (845k in Nov 2026
-- alone), and the admin Home "This month" range began timing out: each
-- get_visitor_totals / get_visitor_bucket_counts call had to count-distinct
-- ~600k page views, and the dashboard runs several at once against the 8s
-- statement timeout.
--
-- storefront_visitor_days keeps one row per (brand, Manila day, visitor) —
-- ~6x fewer rows — maintained by a trigger on every page_view insert. The
-- two functions below read whole days from the rollup and only the partial
-- days at a range's edges (e.g. today so far) from storefront_visits, so the
-- results stay exact: a visitor seen on both sides still counts once.
-- -----------------------------------------------------------------------------
create table storefront_visitor_days (
  brand text not null,
  day date not null,
  visitor_id uuid not null,
  page_views integer not null default 0,
  primary key (brand, day, visitor_id)
);

create index storefront_visitor_days_day_visitor_idx
  on storefront_visitor_days (day, visitor_id);

-- Admin-only data, read through the security-definer functions below via
-- the service-role client — no policies on purpose.
alter table storefront_visitor_days enable row level security;

create or replace function track_storefront_visitor_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into storefront_visitor_days (brand, day, visitor_id, page_views)
  values (
    new.brand,
    (new.created_at at time zone 'Asia/Manila')::date,
    new.visitor_id,
    1
  )
  on conflict (brand, day, visitor_id)
  do update set page_views = storefront_visitor_days.page_views + 1;
  return null;
end;
$$;

-- Created before the backfill in the same transaction: the trigger's lock
-- holds off concurrent inserts until commit, so no page view is either
-- missed or counted twice.
create trigger storefront_visits_track_visitor_day
  after insert on storefront_visits
  for each row
  when (new.event_type = 'page_view')
  execute function track_storefront_visitor_day();

insert into storefront_visitor_days (brand, day, visitor_id, page_views)
select brand, (created_at at time zone 'Asia/Manila')::date, visitor_id, count(*)
from storefront_visits
where event_type = 'page_view'
group by 1, 2, 3;

/** First and last Manila days fully inside [p_from, p_to]. */
create or replace function visitor_full_days(p_from timestamptz, p_to timestamptz)
returns table (first_day date, last_day date)
language sql
immutable
as $$
  select
    case
      when p_from = ((p_from at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila')
        then (p_from at time zone 'Asia/Manila')::date
      else (p_from at time zone 'Asia/Manila')::date + 1
    end,
    case
      when p_to + interval '1 second' >=
        (((p_to at time zone 'Asia/Manila')::date + 1)::timestamp at time zone 'Asia/Manila')
        then (p_to at time zone 'Asia/Manila')::date
      else (p_to at time zone 'Asia/Manila')::date - 1
    end;
$$;

create or replace function get_visitor_totals(
  p_from timestamptz,
  p_to timestamptz,
  p_brand text default null
)
returns table (unique_visitors bigint, page_views bigint)
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
      select count(distinct visitor_id), count(*)
      from storefront_visits
      where event_type = 'page_view'
        and created_at >= p_from
        and created_at <= p_to
        and (p_brand is null or brand = p_brand);
    return;
  end if;

  v_head_end := v_first::timestamp at time zone 'Asia/Manila';
  v_tail_start := (v_last + 1)::timestamp at time zone 'Asia/Manila';

  return query
    with ids as (
      select d.visitor_id, d.page_views::bigint as pv
      from storefront_visitor_days d
      where d.day between v_first and v_last
        and (p_brand is null or d.brand = p_brand)
      union all
      select v.visitor_id, 1::bigint
      from storefront_visits v
      where v.event_type = 'page_view'
        and (
          (v.created_at >= p_from and v.created_at < v_head_end)
          or (v.created_at >= v_tail_start and v.created_at <= p_to)
        )
        and (p_brand is null or v.brand = p_brand)
    )
    select count(distinct ids.visitor_id), coalesce(sum(ids.pv), 0)::bigint
    from ids;
end;
$$;

create or replace function get_visitor_bucket_counts(
  p_from timestamptz,
  p_to timestamptz,
  p_hourly boolean,
  p_brand text default null
)
returns table (bucket_key text, unique_visitors bigint)
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
    return;
  end if;

  select f.first_day, f.last_day into v_first, v_last
  from visitor_full_days(p_from, p_to) f;
  if v_first > v_last then
    -- No whole day inside the range: everything comes from the raw table.
    v_first := 'infinity'::date;
    v_last := '-infinity'::date;
    v_head_end := p_to + interval '1 microsecond';
    v_tail_start := p_to + interval '1 microsecond';
  else
    v_head_end := v_first::timestamp at time zone 'Asia/Manila';
    v_tail_start := (v_last + 1)::timestamp at time zone 'Asia/Manila';
  end if;

  return query
    select to_char(x.day, 'YYYY-MM-DD'), count(distinct x.visitor_id)
    from (
      select d.day, d.visitor_id
      from storefront_visitor_days d
      where d.day between v_first and v_last
        and (p_brand is null or d.brand = p_brand)
      union all
      select (v.created_at at time zone 'Asia/Manila')::date, v.visitor_id
      from storefront_visits v
      where v.event_type = 'page_view'
        and (
          (v.created_at >= p_from and v.created_at < v_head_end)
          or (v.created_at >= v_tail_start and v.created_at <= p_to)
        )
        and (p_brand is null or v.brand = p_brand)
    ) x
    group by x.day;
end;
$$;

revoke execute on function get_visitor_totals(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function get_visitor_bucket_counts(timestamptz, timestamptz, boolean, text) from public, anon, authenticated;
revoke execute on function track_storefront_visitor_day() from public, anon, authenticated;
