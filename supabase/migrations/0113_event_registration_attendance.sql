-- Day-of attendance: lets staff check off who actually showed up,
-- separate from `status` (which tracks slot/payment lifecycle, not
-- physical attendance — a 'confirmed' registrant may never show, and
-- staff may want to mark someone present and later un-check a mistaken
-- tap). Nullable timestamp rather than a boolean, same convention as
-- confirmed_at/released_at: null means not checked in, a timestamp
-- records when.
alter table event_registrations
  add column checked_in_at timestamptz;
