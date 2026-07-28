-- Spades/Ysrael/Aspire 365 now share one deployment and database,
-- distinguished by which domain a request came in on (see
-- server/storefront/domain.ts). Both columns are additive, default to the
-- existing single-brand reality ('spades'), and follow the same
-- plain-text-no-DB-enum convention as orders.source.

-- Which storefront an order was placed on. Independent of orders.source
-- (which channel/platform it came through) — every storefront order today
-- has source='storefront'; going forward it'll also carry a brand.
alter table orders
  add column brand text not null default 'spades';

-- Which storefront a home/about CMS section belongs to, so each brand can
-- have its own hero/homepage content (see server/storefront/sections.ts).
alter table storefront_sections
  add column brand text not null default 'spades';
