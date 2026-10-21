-- Powers the storefront's "there's an event near you" popup
-- (NearbyEventPopup.tsx) — a client-side Haversine distance check against
-- the visitor's browser-geolocated position, so this just needs plain
-- lat/lng, nothing PostGIS. Nullable and optional in the admin form: an
-- event with either unset simply never participates in that popup.
alter table community_events add column latitude double precision;
alter table community_events add column longitude double precision;
