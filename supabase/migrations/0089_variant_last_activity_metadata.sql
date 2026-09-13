-- Extends get_variant_last_activity to also return the winning log row's
-- metadata, so the Inventory page's "last updated" popover can show the
-- actual stock change (before/after quantity), not just who/when. Only
-- inventory.adjust logs carry a `delta` key in metadata (variant edits log
-- {} or unrelated fields like sku) — the frontend uses that to decide
-- whether it's safe to render a stock-change line.
--
-- Postgres can't CREATE OR REPLACE a function that changes its returns
-- table's columns, hence the explicit drop first.
drop function if exists get_variant_last_activity(uuid[]);

create function get_variant_last_activity(variant_ids uuid[])
returns table (variant_id uuid, updated_at timestamptz, staff_name text, metadata jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with relevant_logs as (
    select al.entity_id as variant_id, al.created_at, al.staff_user_id, al.metadata
    from activity_logs al
    where al.entity_type = 'product_variants' and al.entity_id = any(variant_ids)

    union all

    select (al.metadata->>'variantId')::uuid as variant_id, al.created_at, al.staff_user_id, al.metadata
    from activity_logs al
    where al.entity_type = 'inventory'
      and al.metadata ? 'variantId'
      and (al.metadata->>'variantId')::uuid = any(variant_ids)
  ),
  ranked as (
    select rl.variant_id, rl.created_at, rl.staff_user_id, rl.metadata,
           row_number() over (partition by rl.variant_id order by rl.created_at desc) as rn
    from relevant_logs rl
  )
  select r.variant_id, r.created_at, su.full_name, r.metadata
  from ranked r
  left join staff_users su on su.id = r.staff_user_id
  where r.rn = 1;
$$;

revoke execute on function get_variant_last_activity(uuid[]) from public, anon, authenticated;
