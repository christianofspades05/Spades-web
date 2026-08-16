-- Companion to 0075_storefront_visits_country.sql — adds city-level
-- granularity to the same best-effort IP geolocation, so the admin
-- Visitors page can break locations down by city, not just country.
alter table storefront_visits add column city text;
