-- "Block COD by location": staff can disable Cash on Delivery for specific
-- PH cities/municipalities with a history of high return/failed-delivery
-- rates from couriers. A separate axis from cod_restrictions (catalog-
-- scoped: collection/product) — this one is address-scoped.
--
-- Keyed on region+province+city, not city alone: PSGC municipality names
-- can repeat across provinces (several "San Jose"s, "San Fernando"s, etc.)
-- even though city names generally don't — matching on the full tuple
-- avoids accidentally blocking COD in a same-named municipality in a
-- different province.
create table cod_restricted_cities (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  province text not null,
  city text not null,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (region, province, city)
);

-- Same convention as cod_restrictions (0013): only the service-role admin
-- client ever touches this. Enabling RLS with no anon/authenticated
-- policies just keeps it off the auto-generated REST API.
alter table cod_restricted_cities enable row level security;
