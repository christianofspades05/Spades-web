-- admin/analytics.ts filters orders by brand (data.brand / brandFilter) and
-- date range (placed_at) together at ~11 call sites (Sales, Best Sellers,
-- Cancelled, Returns, Product Analytics, etc.), the same pattern
-- 0028_analytics_composite_index.sql already indexed for the channel
-- (source) filter — orders.brand (0044_multi_brand_scoping.sql) never got
-- the equivalent, so every brand-filtered analytics query has been a bitmap
-- AND (or a sequential scan) instead of a single index scan.
create index if not exists orders_brand_placed_at_idx
  on orders (brand, placed_at);
