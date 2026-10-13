-- Powers the Product Analytics nav badge for "a product newly entered the
-- Restock Decisions table" (src/routes/admin/analytics/product-analytics.tsx).
-- That table itself is computed live, with no persisted history — these two
-- tiny tables are the only state needed to tell "just appeared" from "been
-- sitting there a while, already seen it."
--
-- restock_decision_sightings: one row per product currently on the live
-- Restock Decisions list, stamped with when it was FIRST seen there. A
-- product falling off the list (restocked, or demand dropped below the
-- threshold) has its row deleted — so if it resurfaces later, it reads as
-- new again rather than silently staying "already seen" forever.
create table restock_decision_sightings (
  product_id uuid primary key references products (id) on delete cascade,
  first_flagged_at timestamptz not null default now()
);

-- restock_decision_view_state: a singleton row (enforced by the boolean PK
-- trick below — a boolean column can only ever hold true or false, and the
-- check pins it to true, so at most one row can ever exist) recording when
-- staff last viewed the Product Analytics page. The badge counts sightings
-- newer than this.
create table restock_decision_view_state (
  id boolean primary key default true check (id),
  last_viewed_at timestamptz not null default now()
);
insert into restock_decision_view_state (id) values (true);

-- Same convention as every other table here: only the service-role admin
-- client ever touches these. RLS with no anon/authenticated policies just
-- keeps them off the auto-generated REST API.
alter table restock_decision_sightings enable row level security;
alter table restock_decision_view_state enable row level security;
