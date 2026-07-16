-- Discounts admin support: distinguishes customer-entered "discount codes"
-- from automatic "store sales" (no code, applies itself), and lets a store
-- sale exclude specific collections (e.g. exclude "New Releases" from a
-- storewide sale). Redemption at checkout isn't built yet — src/server/checkout
-- is still design-notes-only — this migration only supports admin management.

create type discount_kind as enum ('code', 'automatic');

alter table discounts
  add column kind discount_kind not null default 'code',
  add column title text,
  add column excluded_collection_ids uuid[] not null default '{}';

-- Automatic (store sale) discounts have no customer-facing code.
alter table discounts alter column code drop not null;

update discounts set title = code where title is null;
alter table discounts alter column title set not null;
