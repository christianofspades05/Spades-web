-- Extends get_product_last_activity with a total_stock_delta: for each of
-- the product's variants, take only that variant's single most recent
-- inventory.adjust log (mirrors get_variant_last_activity's own per-variant
-- "last change" — an older adjustment to the same size doesn't still count
-- once a newer one supersedes it), then sum those latest-per-variant deltas
-- across every variant of the product. Shown on the Products list as
-- "Staff adjusted stock +123" — one aggregate figure for a row that
-- represents several variants, unlike the Inventory page's per-variant
-- before/after (see get_variant_last_activity, 0089).
--
-- Postgres can't CREATE OR REPLACE a function that changes its returns
-- table's columns, hence the explicit drop first.
drop function if exists get_product_last_activity(uuid[]);

create function get_product_last_activity(product_ids uuid[])
returns table (
  product_id uuid,
  updated_at timestamptz,
  staff_name text,
  total_stock_delta bigint
)
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
    select al.entity_id as product_id, al.created_at, al.staff_user_id,
           null::uuid as variant_id, null::bigint as delta
    from activity_logs al
    where al.entity_type = 'products' and al.entity_id = any(product_ids)

    union all

    select vm.product_id, al.created_at, al.staff_user_id,
           al.entity_id as variant_id, null::bigint as delta
    from activity_logs al
    join variant_map vm on vm.variant_id = al.entity_id
    where al.entity_type = 'product_variants'

    union all

    select vm.product_id, al.created_at, al.staff_user_id,
           (al.metadata->>'variantId')::uuid as variant_id,
           (al.metadata->>'delta')::bigint as delta
    from activity_logs al
    join variant_map vm on vm.variant_id = (al.metadata->>'variantId')::uuid
    where al.entity_type = 'inventory' and al.metadata ? 'variantId'
  ),
  ranked_overall as (
    select rl.product_id, rl.created_at, rl.staff_user_id,
           row_number() over (partition by rl.product_id order by rl.created_at desc) as rn
    from relevant_logs rl
  ),
  latest_stock_change_per_variant as (
    select rl.product_id, rl.variant_id, rl.delta,
           row_number() over (partition by rl.variant_id order by rl.created_at desc) as rn
    from relevant_logs rl
    where rl.variant_id is not null and rl.delta is not null
  ),
  stock_totals as (
    select product_id, sum(delta) as total_stock_delta
    from latest_stock_change_per_variant
    where rn = 1
    group by product_id
  )
  select r.product_id, r.created_at, su.full_name, st.total_stock_delta
  from ranked_overall r
  left join staff_users su on su.id = r.staff_user_id
  left join stock_totals st on st.product_id = r.product_id
  where r.rn = 1;
$$;

revoke execute on function get_product_last_activity(uuid[]) from public, anon, authenticated;
