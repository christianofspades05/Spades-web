-- Lightweight, anonymous visit tracking for the admin Home dashboard
-- ("Visitors" and "Conversion rate" cards). This is intentionally not a full
-- analytics platform: one row per page load, tagged with a random
-- browser-local visitor id (no PII, no cookies tied to an account). Reads and
-- writes both go through the service-role admin client — RLS stays enabled
-- with no policies, matching every other write path in this project.

create table if not exists storefront_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  path text not null,
  created_at timestamptz not null default now()
);

create index if not exists storefront_visits_created_at_idx
  on storefront_visits (created_at);

create index if not exists storefront_visits_visitor_id_idx
  on storefront_visits (visitor_id);

alter table storefront_visits enable row level security;
