-- Events need an end time, not just a start — backfill existing rows to a
-- reasonable 2-hour default (today there's exactly one live event; staff
-- can correct it from the admin edit page) before enforcing not null, same
-- strictness as starts_at.
alter table community_events add column ends_at timestamptz;
update community_events set ends_at = starts_at + interval '2 hours'
  where ends_at is null;
alter table community_events alter column ends_at set not null;
alter table community_events add constraint community_events_ends_after_starts
  check (ends_at > starts_at);
