-- Caps how many products a collection shows (manual pins first, then
-- auto-matched products fill remaining slots) — e.g. a "New Arrivals"
-- collection with no title/type/tag rule, sorted newest-first, capped at 6.
-- Null means uncapped (today's behavior, unchanged for every existing
-- collection).
alter table collections add column max_products integer;
alter table collections add constraint collections_max_products_positive
  check (max_products is null or max_products > 0);
