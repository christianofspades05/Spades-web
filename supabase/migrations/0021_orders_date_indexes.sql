-- Every admin analytics/overview query (dashboard, sales, profit, cancelled
-- & returns, orders/products overview) filters orders by a placed_at or
-- cancelled_at range. Neither column had an index, so each of those queries
-- was doing a full table scan — the likely cause of slow admin page loads
-- as the orders table has grown from live channel syncing.
create index if not exists orders_placed_at_idx on orders (placed_at);
create index if not exists orders_cancelled_at_idx
  on orders (cancelled_at)
  where cancelled_at is not null;

-- The only existing email index is a functional one on lower(email) (see
-- 0001_init_schema.sql) — every lookup actually filters on the plain column
-- (place-order.ts, sync-engine.ts), which that index can't serve, so every
-- storefront checkout and marketplace order import was seq-scanning the
-- whole customers table just to find/create the customer row.
create index if not exists customers_email_idx on customers (email);

-- orders.source only has a partial unique index scoped to rows with a
-- non-null external_order_id (0001_init_schema.sql) — storefront orders
-- have none, so a plain `source = 'storefront'` filter (the Orders admin
-- page's channel filter, and the Analytics page) can't use it at all.
create index if not exists orders_source_idx on orders (source);

-- returns.requested_at is range-filtered on every Orders page load
-- (getOrdersOverview) and every Analytics page load (getCancelledAndReturns)
-- with no supporting index.
create index if not exists returns_requested_at_idx on returns (requested_at);

-- Sorted by on every load of their respective admin list pages, with no
-- supporting index for the sort.
create index if not exists customers_created_at_idx on customers (created_at desc);
create index if not exists products_created_at_idx on products (created_at desc);
create index if not exists reviews_created_at_idx on reviews (created_at desc);
