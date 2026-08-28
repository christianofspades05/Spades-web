-- Batch "last updated" lookups for the admin last-activity indicator.
--
-- A product's edit history is scattered across three different
-- activity_logs entity_type groupings: direct product edits
-- (entity_type='products'), variant quick-edits
-- (entity_type='product_variants'), and inventory adjustments
-- (entity_type='inventory', with the actual variant id buried in
-- metadata->>'variantId' rather than entity_id). These two functions
-- fan out across all three per product/variant and return only the
-- single most recent row, batched over an array of ids to avoid an
-- N+1 query per row on the Products list / Inventory page.
create or replace function get_product_last_activity(product_ids uuid[])
returns table (product_id uuid, updated_at timestamptz, staff_name text)
language sql
stable
security definer
set search_path = public
as $$
  with variant_map as (
    select id as variant_id, product_id
    from product_variants
    where product_id = any(product_ids)
  ),
  relevant_logs as (
    select al.entity_id as product_id, al.created_at, al.staff_user_id
    from activity_logs al
    where al.entity_type = 'products' and al.entity_id = any(product_ids)

    union all

    select vm.product_id, al.created_at, al.staff_user_id
    from activity_logs al
    join variant_map vm on vm.variant_id = al.entity_id
    where al.entity_type = 'product_variants'

    union all

    select vm.product_id, al.created_at, al.staff_user_id
    from activity_logs al
    join variant_map vm on vm.variant_id = (al.metadata->>'variantId')::uuid
    where al.entity_type = 'inventory' and al.metadata ? 'variantId'
  ),
  ranked as (
    select rl.product_id, rl.created_at, rl.staff_user_id,
           row_number() over (partition by rl.product_id order by rl.created_at desc) as rn
    from relevant_logs rl
  )
  select r.product_id, r.created_at, su.full_name
  from ranked r
  left join staff_users su on su.id = r.staff_user_id
  where r.rn = 1;
$$;

-- Variant-scoped counterpart for the Inventory page, which is keyed on
-- variant rows rather than products. Deliberately excludes
-- entity_type='products' (a product-level edit like renaming isn't a
-- stock-relevant change for a specific variant row).
create or replace function get_variant_last_activity(variant_ids uuid[])
returns table (variant_id uuid, updated_at timestamptz, staff_name text)
language sql
stable
security definer
set search_path = public
as $$
  with relevant_logs as (
    select al.entity_id as variant_id, al.created_at, al.staff_user_id
    from activity_logs al
    where al.entity_type = 'product_variants' and al.entity_id = any(variant_ids)

    union all

    select (al.metadata->>'variantId')::uuid as variant_id, al.created_at, al.staff_user_id
    from activity_logs al
    where al.entity_type = 'inventory'
      and al.metadata ? 'variantId'
      and (al.metadata->>'variantId')::uuid = any(variant_ids)
  ),
  ranked as (
    select rl.variant_id, rl.created_at, rl.staff_user_id,
           row_number() over (partition by rl.variant_id order by rl.created_at desc) as rn
    from relevant_logs rl
  )
  select r.variant_id, r.created_at, su.full_name
  from ranked r
  left join staff_users su on su.id = r.staff_user_id
  where r.rn = 1;
$$;

-- Only ever called via the server-only service-role client, same pattern as
-- get_visitor_totals/etc. (see 0077_visitor_analytics_aggregate_functions.sql).
revoke execute on function get_product_last_activity(uuid[]) from public, anon, authenticated;
revoke execute on function get_variant_last_activity(uuid[]) from public, anon, authenticated;
