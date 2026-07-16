-- Extends the lightweight visit-tracking table from 0002 so it can carry a
-- named event (page_view, checkout_start, ...) instead of only ever meaning
-- "a page was loaded". Existing rows default to 'page_view' so the admin
-- dashboard's visitor/conversion aggregation over storefront_visits keeps
-- working unchanged once it filters on event_type = 'page_view'.

alter table storefront_visits
  add column if not exists event_type text not null default 'page_view',
  add column if not exists product_id uuid references products (id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists storefront_visits_event_type_created_at_idx
  on storefront_visits (event_type, created_at);
