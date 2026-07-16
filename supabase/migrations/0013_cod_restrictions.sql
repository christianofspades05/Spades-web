-- "Hide Payments": lets staff block Cash on Delivery for specific
-- collections or products (e.g. a Clearance Sale collection that must be
-- paid online, never COD). Mirrors discounts' scope/scope_ids shape, minus
-- 'all'/'variant' — a restriction only ever targets a collection or a
-- specific set of products.
create type cod_restriction_scope as enum ('collection', 'product');

create table cod_restrictions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  scope cod_restriction_scope not null,
  scope_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same convention as every other table (see 0001_init_schema.sql): only the
-- service-role admin client ever touches this, which bypasses RLS entirely.
-- Enabling RLS with no anon/authenticated policies just makes sure the
-- auto-generated REST API can't expose it via the public anon key.
alter table cod_restrictions enable row level security;
