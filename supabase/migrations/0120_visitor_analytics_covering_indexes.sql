-- Fixes /admin?range=this_year (and any ~300+ day range) throwing
-- "canceling statement due to statement timeout". The admin Home dashboard
-- fires get_visitor_totals/get_visitor_bucket_counts/get_visitor_countries
-- (0077/0078) several times concurrently per page load; at a ~310-day range
-- these were scanning 1.6M+ matching storefront_visits rows each, with no
-- index covering (event_type, visitor_id)/(event_type, country,
-- visitor_id)/the store-local-date expression, forcing heap fetches and
-- (for the two GROUP BY queries) an external-merge disk sort — 8s / 5.2s /
-- 4.5s respectively, and worse under concurrent contention for work_mem and
-- disk I/O, which is what actually blew the statement timeout.
--
-- Applied to production directly via CREATE INDEX CONCURRENTLY (outside
-- this migration, since storefront_visits takes continuous writes from live
-- storefront traffic and a plain CREATE INDEX would hold it locked for the
-- whole build) — this file is for schema history / fresh databases, where
-- the table starts empty and a plain CREATE INDEX is instant.
--
-- storefront_visits_pageview_covering_idx from an earlier attempt was
-- superseded and dropped in production: ordering by (event_type,
-- created_at) still left the DISTINCT count needing a separate sort step.
-- Ordering by visitor_id/country directly (matching each RPC's own
-- distinct-count/group-by column) lets Postgres stream the aggregate
-- straight off the index instead.
create index if not exists storefront_visits_pageview_visitor_covering_idx
  on storefront_visits (event_type, visitor_id)
  include (created_at, brand, country);

create index if not exists storefront_visits_pageview_country_visitor_idx
  on storefront_visits (event_type, country, visitor_id)
  include (created_at, brand);

-- Must match the exact expression get_visitor_bucket_counts's non-hourly
-- path groups by (see 0121) — a textually different but value-equivalent
-- expression (e.g. the old to_char(created_at + interval '8 hours', ...))
-- won't be recognized as satisfying this index.
create index if not exists storefront_visits_pageview_date_visitor_idx
  on storefront_visits (event_type, ((created_at at time zone interval '+08:00')::date), visitor_id)
  include (created_at, brand, country);
