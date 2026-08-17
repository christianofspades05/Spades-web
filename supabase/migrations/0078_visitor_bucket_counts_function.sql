-- Fixes the admin Home dashboard's "fetch failed" on any range wider than a
-- single day (today) — getDashboardAnalytics was pulling every matching
-- storefront_visits row into Node (100s of thousands for "this month",
-- 300+ sequential paged requests) just to bucket-count unique visitors per
-- day/hour in memory. Groups by the same store-local (UTC+8) day/hour key
-- storeLocalDateKey/storeLocalHourKey already compute in JS, so results
-- still line up with bucketPeriod's per-bucket index.
create or replace function get_visitor_bucket_counts(
  p_from timestamptz,
  p_to timestamptz,
  p_hourly boolean,
  p_brand text default null
) returns table(bucket_key text, unique_visitors bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when p_hourly
      then to_char(created_at + interval '8 hours', 'YYYY-MM-DD"T"HH24')
      else to_char(created_at + interval '8 hours', 'YYYY-MM-DD')
    end as bucket_key,
    count(distinct visitor_id)
  from storefront_visits
  where event_type = 'page_view'
    and created_at >= p_from
    and created_at <= p_to
    and (p_brand is null or brand = p_brand)
  group by 1
$$;

revoke execute on function get_visitor_bucket_counts(timestamptz, timestamptz, boolean, text) from public, anon, authenticated;
