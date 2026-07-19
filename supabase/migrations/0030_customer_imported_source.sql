-- Marks customers imported from the Shopify Online Store customer export as
-- belonging to that channel — they have no rows in `orders` (their order
-- history lives only in Shopify, never migrated), so the existing
-- Channel filter — which derives "belongs to channel X" purely from
-- orders.source — would otherwise never recognize them as Online Store
-- customers at all.
alter table customers add column imported_source text null;
