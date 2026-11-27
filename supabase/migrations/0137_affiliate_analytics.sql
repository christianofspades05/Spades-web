-- -----------------------------------------------------------------------------
-- Admin Analytics → Affiliates (/admin/analytics/affiliates).
--
-- Answers "is this creator worth what we spend on them?". Read-only
-- reporting functions on top of the creator tables from 0091/0135, plus the
-- attribution_type column the link-tracking work (0138) writes to.
--
-- Money follows the Profit page (src/server/admin/analytics.ts,
-- getOrderProfitList) so the same order shows the same profit on both pages:
--   net sales    = subtotal − discount − refunds  (product revenue; 0 if void)
--   order profit = net sales + shipping billed − COGS − platform fees
--   COGS         = qty × the line's cost snapshot, falling back to the
--                  variant's current cost (free-gift lines included)
-- "Void" = cancelled / failed, same as the Profit page's VOID_STATUSES.
--
-- Creator-level money on top of that:
--   spent          = gifts + content fees + other expenses + commission earned
--   creator profit = Σ order profit − commission earned − expenses
--   ROI            = creator profit ÷ spent
--
-- All functions are staff-only in practice: no browser role can execute
-- them; the server calls them with the service-role client after
-- requireStaff().
-- -----------------------------------------------------------------------------

alter table order_creator_attributions
  add column if not exists attribution_type text not null default 'code'
    check (attribution_type in ('code', 'link'));

-- Link clicks are counted from storefront_visits by event_type (indexed via
-- storefront_visits_event_type_created_at_idx from 0007), never a full scan.

-- One row per attributed order (any status) placed in [p_start, p_end].
-- Null bounds mean "no limit".
create or replace function creator_order_facts(
  p_start timestamptz,
  p_end timestamptz,
  p_creator_id uuid default null
)
returns table (
  order_id uuid,
  creator_id uuid,
  order_number text,
  placed_at timestamptz,
  order_status text,
  attribution_type text,
  code_snapshot text,
  customer_id uuid,
  is_void boolean,
  is_cancel_or_return boolean,
  net_sales_cents bigint,
  shipping_revenue_cents bigint,
  cogs_cents bigint,
  platform_fees_cents bigint,
  order_profit_cents bigint,
  earned_cents integer,
  paid_cents integer,
  attribution_status text,
  hold_count integer,
  eligible_at timestamptz,
  is_new_customer boolean,
  rate_kind text
)
language sql stable set search_path = public as $$
  with a as (
    select a.order_id, a.creator_id, a.attribution_type, a.code_snapshot,
      a.commission_bps, a.earned_cents, a.paid_cents, a.status, a.hold_reasons,
      a.eligible_at, o.order_number, o.placed_at, o.status::text as ostatus,
      o.customer_id, o.source::text as source, o.subtotal_cents, o.discount_cents,
      o.shipping_cents, o.platform_fees_cents
    from order_creator_attributions a
    join orders o on o.id = a.order_id
    where (p_start is null or o.placed_at >= p_start)
      and (p_end is null or o.placed_at <= p_end)
      and (p_creator_id is null or a.creator_id = p_creator_id)
  ),
  items as (
    select oi.order_id,
      sum(oi.quantity::bigint * coalesce(oi.unit_cost_cents_snapshot, pv.cost_cents, 0)) as cogs,
      bool_or(oi.creator_commission_bps is not null and oi.creator_commission_bps <> a.commission_bps) as any_sale,
      bool_or(oi.creator_commission_bps is not null and oi.creator_commission_bps = a.commission_bps and oi.line_total_cents > 0) as any_normal
    from order_items oi
    join a on a.order_id = oi.order_id
    left join product_variants pv on pv.id = oi.variant_id
    group by oi.order_id
  ),
  refunds as (
    select r.order_id, sum(r.refund_amount_cents)::bigint as refund
    from order_financial_refunds r
    join a on a.order_id = r.order_id
    where r.status = 'refunded'
    group by r.order_id
  )
  select
    a.order_id,
    a.creator_id,
    a.order_number,
    a.placed_at,
    a.ostatus,
    a.attribution_type,
    a.code_snapshot,
    a.customer_id,
    a.ostatus in ('cancelled', 'failed') as is_void,
    (a.ostatus in ('cancelled', 'failed', 'refunded')
      or exists (select 1 from returns rt where rt.order_id = a.order_id
                 and rt.status::text in ('received', 'refunded'))
      or exists (select 1 from shipments s where s.order_id = a.order_id
                 and s.status::text in ('failed', 'returned_to_sender'))) as is_cancel_or_return,
    case when a.ostatus in ('cancelled', 'failed') then 0
      else a.subtotal_cents - a.discount_cents - coalesce(rf.refund, 0) end as net_sales_cents,
    case when a.ostatus in ('cancelled', 'failed') then 0
      when a.source in ('storefront', 'admin') then a.shipping_cents::bigint else 0 end as shipping_revenue_cents,
    case when a.ostatus in ('cancelled', 'failed') then 0 else coalesce(it.cogs, 0) end as cogs_cents,
    case when a.ostatus in ('cancelled', 'failed') then 0 else a.platform_fees_cents::bigint end as platform_fees_cents,
    case when a.ostatus in ('cancelled', 'failed') then 0
      else a.subtotal_cents - a.discount_cents - coalesce(rf.refund, 0)
        + case when a.source in ('storefront', 'admin') then a.shipping_cents else 0 end
        - coalesce(it.cogs, 0) - a.platform_fees_cents end as order_profit_cents,
    a.earned_cents,
    a.paid_cents,
    a.status,
    cardinality(a.hold_reasons),
    a.eligible_at,
    not exists (select 1 from orders prev where prev.customer_id = a.customer_id
                and prev.placed_at < a.placed_at
                and prev.status::text not in ('cancelled', 'failed')) as is_new_customer,
    case when coalesce(it.any_sale, false) and coalesce(it.any_normal, false) then 'mixed'
      when coalesce(it.any_sale, false) then 'sale'
      else 'normal' end as rate_kind
  from a
  left join items it on it.order_id = a.order_id
  left join refunds rf on rf.order_id = a.order_id
$$;

-- Leaderboard: one row per creator for [p_start, p_end], plus the all-time
-- facts the status rules need (last gift, orders since it, commission owed,
-- last 60 days' profit/spend).
create or replace function creator_performance(p_start timestamptz, p_end timestamptz)
returns table (
  creator_id uuid,
  name text,
  is_active boolean,
  tiktok_url text,
  instagram_url text,
  facebook_url text,
  codes text[],
  code_brands text[],
  has_active_code boolean,
  gifts_cents bigint,
  content_fees_cents bigint,
  other_expenses_cents bigint,
  commission_earned_cents bigint,
  attributed_orders integer,
  orders integer,
  code_orders integer,
  link_orders integer,
  cancel_return_orders integer,
  net_sales_cents bigint,
  cogs_cents bigint,
  order_profit_cents bigint,
  new_customer_orders integer,
  link_clicks integer,
  last_order_at timestamptz,
  last_gift_at timestamptz,
  orders_since_last_gift integer,
  lifetime_expenses_cents bigint,
  commission_eligible_cents bigint,
  commission_on_hold_cents bigint,
  profit_60d_cents bigint,
  spent_60d_cents bigint
)
language sql stable set search_path = public as $$
  with facts as (
    select * from creator_order_facts(p_start, p_end)
  ),
  agg as (
    select f.creator_id,
      count(*)::int as attributed_orders,
      count(*) filter (where not f.is_cancel_or_return)::int as orders,
      count(*) filter (where not f.is_cancel_or_return and f.attribution_type = 'code')::int as code_orders,
      count(*) filter (where not f.is_cancel_or_return and f.attribution_type = 'link')::int as link_orders,
      count(*) filter (where f.is_cancel_or_return)::int as cancel_return_orders,
      coalesce(sum(f.net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(f.cogs_cents), 0)::bigint as cogs_cents,
      coalesce(sum(f.order_profit_cents), 0)::bigint as order_profit_cents,
      coalesce(sum(f.earned_cents), 0)::bigint as earned,
      count(*) filter (where not f.is_cancel_or_return and f.is_new_customer)::int as new_customer_orders
    from facts f
    group by f.creator_id
  ),
  exp as (
    select e.creator_id,
      coalesce(sum(e.amount_cents) filter (where e.kind = 'gift'), 0)::bigint as gifts,
      coalesce(sum(e.amount_cents) filter (where e.kind = 'content_fee'), 0)::bigint as fees,
      coalesce(sum(e.amount_cents) filter (where e.kind = 'other'), 0)::bigint as other
    from creator_expenses e
    where (p_start is null or e.incurred_at >= p_start)
      and (p_end is null or e.incurred_at <= p_end)
    group by e.creator_id
  ),
  life as (
    select e.creator_id,
      sum(e.amount_cents)::bigint as lifetime_expenses,
      max(e.incurred_at) filter (where e.kind in ('gift', 'content_fee')) as last_gift_at
    from creator_expenses e
    group by e.creator_id
  ),
  owed as (
    select a.creator_id,
      coalesce(sum(a.earned_cents - a.paid_cents) filter (
        where a.earned_cents > a.paid_cents
          and (a.status = 'APPROVED' or (a.status = 'PENDING' and cardinality(a.hold_reasons) = 0))), 0)::bigint as eligible,
      coalesce(sum(a.earned_cents - a.paid_cents) filter (
        where a.earned_cents > a.paid_cents and a.status = 'PENDING' and cardinality(a.hold_reasons) > 0), 0)::bigint as on_hold,
      max(o.placed_at) filter (where o.status::text not in ('cancelled', 'failed')) as last_order_at
    from order_creator_attributions a
    join orders o on o.id = a.order_id
    group by a.creator_id
  ),
  since_gift as (
    select l.creator_id, count(o.id)::int as n
    from life l
    join order_creator_attributions a on a.creator_id = l.creator_id
    join orders o on o.id = a.order_id
    where l.last_gift_at is not null and o.placed_at >= l.last_gift_at
      and o.status::text not in ('cancelled', 'failed', 'refunded')
    group by l.creator_id
  ),
  last60 as (
    select f.creator_id,
      coalesce(sum(f.order_profit_cents), 0)::bigint as profit,
      coalesce(sum(f.earned_cents), 0)::bigint as earned
    from creator_order_facts(now() - interval '60 days', null) f
    group by f.creator_id
  ),
  exp60 as (
    select e.creator_id, sum(e.amount_cents)::bigint as spent
    from creator_expenses e
    where e.incurred_at >= now() - interval '60 days'
    group by e.creator_id
  ),
  codes as (
    select ca.creator_id,
      array_agg(d.code order by d.code) filter (where ca.is_active and d.code is not null) as codes,
      array_agg(ca.brand order by d.code) filter (where ca.is_active and d.code is not null) as brands,
      bool_or(ca.is_active) as has_active
    from creator_discount_assignments ca
    join discounts d on d.id = ca.discount_id
    group by ca.creator_id
  ),
  clicks as (
    select (v.metadata ->> 'creator_id')::uuid as creator_id, count(*)::int as n
    from storefront_visits v
    where v.event_type = 'creator_link_visit'
      and (p_start is null or v.created_at >= p_start)
      and (p_end is null or v.created_at <= p_end)
    group by 1
  )
  select
    c.id,
    c.name,
    c.is_active,
    c.tiktok_url,
    c.instagram_url,
    c.facebook_url,
    coalesce(cd.codes, '{}'),
    coalesce(cd.brands, '{}'),
    coalesce(cd.has_active, false),
    coalesce(exp.gifts, 0),
    coalesce(exp.fees, 0),
    coalesce(exp.other, 0),
    coalesce(agg.earned, 0),
    coalesce(agg.attributed_orders, 0),
    coalesce(agg.orders, 0),
    coalesce(agg.code_orders, 0),
    coalesce(agg.link_orders, 0),
    coalesce(agg.cancel_return_orders, 0),
    coalesce(agg.net_sales_cents, 0),
    coalesce(agg.cogs_cents, 0),
    coalesce(agg.order_profit_cents, 0),
    coalesce(agg.new_customer_orders, 0),
    coalesce(clicks.n, 0),
    owed.last_order_at,
    life.last_gift_at,
    coalesce(since_gift.n, 0),
    coalesce(life.lifetime_expenses, 0),
    coalesce(owed.eligible, 0),
    coalesce(owed.on_hold, 0),
    coalesce(last60.profit, 0) - coalesce(last60.earned, 0) - coalesce(exp60.spent, 0),
    coalesce(last60.earned, 0) + coalesce(exp60.spent, 0)
  from creators c
  left join agg on agg.creator_id = c.id
  left join exp on exp.creator_id = c.id
  left join life on life.creator_id = c.id
  left join owed on owed.creator_id = c.id
  left join since_gift on since_gift.creator_id = c.id
  left join last60 on last60.creator_id = c.id
  left join exp60 on exp60.creator_id = c.id
  left join codes cd on cd.creator_id = c.id
  left join clicks on clicks.creator_id = c.id
$$;

-- Detail drawer for one creator: daily series (p_tz day buckets), gift
-- effect (all-time, ±14 days around each gift/fee), expenses (all-time),
-- orders + top products (range), payouts (all-time), notes.
create or replace function creator_detail(
  p_creator_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_tz text default 'Asia/Manila'
)
returns jsonb
language sql stable set search_path = public as $$
  with facts as (
    select * from creator_order_facts(p_start, p_end, p_creator_id)
  ),
  all_orders as (
    select o.placed_at
    from order_creator_attributions a
    join orders o on o.id = a.order_id
    where a.creator_id = p_creator_id
      and o.status::text not in ('cancelled', 'failed', 'refunded')
  )
  select jsonb_build_object(
    'creator', (select jsonb_build_object('id', c.id, 'name', c.name, 'notes', c.notes,
        'isActive', c.is_active, 'tiktokUrl', c.tiktok_url, 'instagramUrl', c.instagram_url,
        'facebookUrl', c.facebook_url)
      from creators c where c.id = p_creator_id),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'orders', n, 'netSalesCents', s) order by d)
      from (
        select to_char(f.placed_at at time zone p_tz, 'YYYY-MM-DD') as d,
          count(*) filter (where not f.is_cancel_or_return) as n,
          sum(f.net_sales_cents) as s
        from facts f group by 1
      ) x), '[]'::jsonb),
    'clicksDaily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'clicks', n) order by d)
      from (
        select to_char(v.created_at at time zone p_tz, 'YYYY-MM-DD') as d, count(*) as n
        from storefront_visits v
        where v.event_type = 'creator_link_visit'
          and v.metadata ->> 'creator_id' = p_creator_id::text
          and (p_start is null or v.created_at >= p_start)
          and (p_end is null or v.created_at <= p_end)
        group by 1
      ) x), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'description', e.description,
          'amountCents', e.amount_cents, 'quantity', e.quantity,
          'unitCostCents', e.unit_cost_cents, 'incurredAt', e.incurred_at,
          'date', to_char(e.incurred_at at time zone p_tz, 'YYYY-MM-DD'),
          'productName', p.name,
          'variantLabel', nullif(concat_ws(' / ', pv.size, pv.color, pv.style), ''),
          'ordersBefore14d', (select count(*) from all_orders ao
              where ao.placed_at >= e.incurred_at - interval '14 days' and ao.placed_at < e.incurred_at),
          'ordersAfter14d', (select count(*) from all_orders ao
              where ao.placed_at >= e.incurred_at and ao.placed_at < e.incurred_at + interval '14 days'))
        order by e.incurred_at desc)
      from creator_expenses e
      left join product_variants pv on pv.id = e.variant_id
      left join products p on p.id = pv.product_id
      where e.creator_id = p_creator_id), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'orderId', f.order_id, 'orderNumber', f.order_number, 'placedAt', f.placed_at,
          'status', f.order_status, 'attributionType', f.attribution_type,
          'code', f.code_snapshot, 'netSalesCents', f.net_sales_cents,
          'profitCents', f.order_profit_cents, 'commissionCents', f.earned_cents,
          'paidCents', f.paid_cents, 'commissionStatus', f.attribution_status,
          'rateKind', f.rate_kind, 'isNewCustomer', f.is_new_customer,
          'isCancelOrReturn', f.is_cancel_or_return)
        order by f.placed_at desc)
      from facts f), '[]'::jsonb),
    'topProducts', coalesce((
      select jsonb_agg(jsonb_build_object('productName', t.name, 'quantity', t.qty,
          'netSalesCents', t.net) order by t.qty desc, t.net desc)
      from (
        select oi.product_name_snapshot as name, sum(oi.quantity) as qty,
          sum(coalesce(oi.charged_product_cents - oi.charged_discount_cents, oi.line_total_cents)) as net
        from order_items oi
        join facts f on f.order_id = oi.order_id
        where not f.is_cancel_or_return
        group by 1
        order by 2 desc, 3 desc
        limit 10
      ) t), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'reference', p.reference,
          'amountCents', p.amount_cents, 'createdAt', p.created_at) order by p.created_at desc)
      from creator_payouts p where p.creator_id = p_creator_id), '[]'::jsonb)
  )
$$;

do $$ declare f text; begin
  foreach f in array array[
    'creator_order_facts(timestamptz,timestamptz,uuid)',
    'creator_performance(timestamptz,timestamptz)',
    'creator_detail(uuid,timestamptz,timestamptz,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
