-- The new Sales Analytics / Best Sellers admin section filters orders by
-- channel (source) and date range (placed_at) together on every query.
-- orders_source_idx and orders_placed_at_idx (0021) already exist as single-
-- column indexes, but a composite index serves that combined WHERE clause
-- directly instead of relying on a bitmap AND of two separate index scans.
create index if not exists orders_source_placed_at_idx
  on orders (source, placed_at);
