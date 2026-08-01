-- Live-viewer presence: one row per anonymous visitor (same visitor_id
-- storefront_visits already uses), upserted on every heartbeat rather than
-- inserted — this table represents current state, not a history log.
-- "Currently active" = last_seen_at within the last ~90s (3x the client's
-- ~20s heartbeat interval, tolerating a couple of missed pings).
create table if not exists storefront_presence (
  visitor_id uuid primary key,
  brand text not null default 'spades',
  path text,
  last_seen_at timestamptz not null default now()
);
create index if not exists storefront_presence_last_seen_at_idx
  on storefront_presence (last_seen_at);
alter table storefront_presence enable row level security;
