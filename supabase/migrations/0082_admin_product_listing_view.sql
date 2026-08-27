-- Mirrors storefront_product_listing's own stock aggregation (same
-- product_variants + inventory LATERAL join, same is_active filter on
-- variants) but WITHOUT that view's `where status = 'active'` restriction,
-- since the admin products list needs to sort/filter drafts and archived
-- products by inventory too, not just active ones.
--
-- Admin-only: queried exclusively via the service-role client
-- (getSupabaseAdminClient), which bypasses RLS/grants entirely, so this
-- intentionally has no `security_invoker` clause and no grant to
-- anon/authenticated — unlike storefront_product_listing, nothing here is
-- meant to be reachable by a public/customer-facing client.
create or replace view admin_product_listing as
select
  p.*,
  coalesce(v.total_stock, 0) as total_stock
from products p
left join lateral (
  select sum(coalesce(inv.quantity_available, 0)) as total_stock
  from product_variants pv
  left join inventory inv on inv.variant_id = pv.id
  where pv.product_id = p.id and pv.is_active = true
) v on true;
