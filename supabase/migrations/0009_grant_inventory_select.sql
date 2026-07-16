-- Migration 0004 was meant to add a public-read RLS policy on `inventory`
-- ("public read inventory" using (true)), so the storefront (anon/customer
-- sessions) could compute real stock. On the live database that policy was
-- never actually created — checked via pg_policies, zero rows for
-- tablename = 'inventory' — even though the base GRANT SELECT to
-- anon/authenticated was already present. With RLS enabled (from migration
-- 0001) and no matching policy, every anon/customer query against
-- `inventory` silently returns zero rows (no error), which every storefront
-- stock computation (the product listing view's total_stock, the product
-- detail page's per-variant stock, and any collection's
-- hide_out_of_stock_products filter) reads as "0 in stock" for every
-- product.
grant select on inventory to anon, authenticated;

create policy "public read inventory" on inventory for select using (true);
