-- "Have any recommendations?" form on the /reviews page. Same convention as
-- storefront_visits (0002_storefront_visits.sql): anonymous public write, RLS
-- enabled with no policies at all, reads/writes go through the service-role
-- admin client only (src/server/feedback/submit.ts).
create table store_feedback (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  phone text,
  comment text,
  created_at timestamptz not null default now()
);

create index store_feedback_created_at_idx on store_feedback (created_at);

alter table store_feedback enable row level security;
