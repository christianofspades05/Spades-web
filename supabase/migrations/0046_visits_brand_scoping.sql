-- Lets the admin's Home/Sales/Profit analytics filter by brand the same way
-- orders already do (see 0044_multi_brand_scoping.sql) — storefront_visits
-- had no way to say which brand's domain a page view happened on, so
-- Visitors/Conversion rate could never be scoped per brand.
alter table storefront_visits
  add column brand text not null default 'spades';
