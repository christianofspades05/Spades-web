-- Powers the admin Visitors analytics page (top visitor locations).
-- Best-effort: only populated where Vercel's edge IP-geolocation header is
-- present (production; absent in local dev), same caveat as the existing
-- checkout market-pricing / currency-default geo lookups.
alter table storefront_visits add column country text;
