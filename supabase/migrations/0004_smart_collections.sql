-- Hybrid collections: every collection can combine rule-based auto-matching
-- with manually pinned products, rather than forcing an either/or choice.
--   - `rules` + `match_type`: if rules is non-empty, any product matching
--     them is included automatically (product fields + derived stock/price).
--     An empty rules array matches nothing on its own.
--   - product_collections rows (pre-existing table): manually pinned
--     products, always included regardless of whether they match `rules`,
--     shown/ordered first per their sort_order.
-- Final storefront membership = manual picks ∪ rule matches (deduped).
-- `sort_by` controls the ordering of the rule-matched portion only.

create type collection_match_type as enum ('all', 'any');

alter table collections
  add column match_type collection_match_type not null default 'all',
  add column rules jsonb not null default '[]'::jsonb,
  add column sort_by text not null default 'title_asc';

-- The storefront now needs to read stock (for inventory_stock rules and the
-- "hide out-of-stock products" toggle) using the anon/customer client, not
-- just the staff/service-role one. Migration 0001 never gave `inventory` a
-- public-read policy — every other public-facing table already has one.
create policy "public read inventory" on inventory for select using (true);
