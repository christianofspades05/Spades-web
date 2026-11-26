-- -----------------------------------------------------------------------------
-- Affiliate code "sale mode". Creator-assigned codes now always apply, even
-- during a store-wide sale: on lines that are already on sale they add a
-- smaller extra discount (sale_discount_percent, default 1%) and earn the
-- creator a smaller commission (sale_commission_bps, default 2%); full-price
-- lines keep the code's own value (discounts.value) and commission_bps.
-- Which rate each line got is decided at checkout (src/server/cart/
-- discount.ts) and snapshotted per order line, so later rate edits only
-- affect new orders.
-- -----------------------------------------------------------------------------
alter table creator_discount_assignments
  add column sale_discount_percent numeric not null default 1
    check (sale_discount_percent between 0 and 100),
  add column sale_commission_bps integer not null default 200
    check (sale_commission_bps between 0 and 10000);

-- The commission rate this line earns, set at checkout for orders using an
-- affiliate code (null on older orders / non-affiliate orders).
alter table order_items
  add column creator_commission_bps integer
    check (creator_commission_bps between 0 and 10000);

-- commission_bps stays the agreement's normal rate. These record what the
-- order actually earned at: the blended rate, and per line for audits.
alter table order_creator_attributions
  add column effective_commission_bps numeric(7,2),
  add column rate_breakdown jsonb not null default '[]';

-- Online payments: carry the per-line rate from the reservation snapshot
-- into order_items (same function as 0123, plus creator_commission_bps).
create or replace function mint_checkout_order(p_reservation_id uuid,p_payment jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r checkout_reservations%rowtype; o orders%rowtype; item jsonb; begin
  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text,92));
  select * into o from orders where source='storefront' and external_order_id=p_reservation_id::text;
  if o.id is not null then return jsonb_build_object('id',o.id,'orderNumber',o.order_number,'created',false); end if;
  select * into r from checkout_reservations where id=p_reservation_id for update;
  if r.id is null then raise exception 'Checkout reservation not found'; end if;
  insert into orders(customer_id,status,source,external_order_id,subtotal_cents,discount_cents,shipping_cents,total_cents,discount_id,
    shipping_address,is_cod,currency,brand,market_markup_percent,shipping_method,lalamove_info,customer_notes,has_pre_order_items,fbclid,ad_campaign_name)
  values(r.customer_id,'paid','storefront',r.id::text,r.subtotal_cents,r.discount_cents,r.shipping_cents,r.total_cents,r.discount_id,
    r.shipping_address,false,r.currency,r.brand,r.market_markup_percent,r.shipping_method,r.lalamove_info,r.customer_notes,
    exists(select 1 from jsonb_array_elements(r.items) x where (x->>'isPreOrder')::boolean),r.fbclid,r.ad_campaign_name) returning * into o;
  for item in select * from jsonb_array_elements(r.items) loop
    insert into order_items(order_id,variant_id,product_name_snapshot,variant_label_snapshot,sku_snapshot,unit_price_cents,quantity,
      line_subtotal_cents,line_discount_cents,line_total_cents,is_pre_order,charged_product_cents,charged_discount_cents,unit_cost_cents_snapshot,
      creator_commission_bps)
    values(o.id,(item->>'variantId')::uuid,item->>'productNameSnapshot',item->>'variantLabelSnapshot',item->>'skuSnapshot',
      (item->>'unitPriceCents')::integer,(item->>'quantity')::integer,(item->>'lineSubtotalCents')::integer,
      (item->>'lineDiscountCents')::integer,(item->>'lineTotalCents')::integer,coalesce((item->>'isPreOrder')::boolean,false),
      (item->>'chargedProductCents')::integer,(item->>'chargedDiscountCents')::integer,(item->>'unitCostCentsSnapshot')::integer,
      (item->>'creatorCommissionBps')::integer);
    if item->>'variantId' is not null and not coalesce((item->>'isPreOrder')::boolean,false) then
      perform commit_variant_stock((item->>'variantId')::uuid,(item->>'quantity')::integer,'main','order',o.id);
    end if;
  end loop;
  insert into payments(order_id,provider,provider_reference,status,amount_cents,idempotency_key,captured_at,charged_currency,charged_amount_cents,raw_payload)
  values(o.id,(p_payment->>'provider')::payment_provider,p_payment->>'providerReference','captured',r.total_cents,
    'checkout:'||r.id::text,now(),p_payment->>'chargedCurrency',(p_payment->>'chargedAmountCents')::integer,p_payment->'rawPayload');
  if r.discount_id is not null then update discounts set times_used=times_used+1 where id=r.discount_id; end if;
  delete from checkout_reservations where id=r.id;
  return jsonb_build_object('id',o.id,'orderNumber',o.order_number,'created',true);
end $$;

-- Per-line commission (same function as 0091, with per-line rates).
create or replace function reconcile_creator_order(p_order_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare a order_creator_attributions%rowtype; o orders%rowtype; i record;
  cid uuid; revenue bigint:=0; earned integer; costs bigint:=0; missing boolean:=false;
  holds text[]:='{}'; delivery timestamptz; eligible timestamptz; next_status text;
  net integer; returned_qty integer; removed bigint; refunds bigint; returned_refunds bigint;
  gross_sum bigint; discount_sum bigint; item_count integer;
  line_revenue bigint; line_bps integer; weighted numeric:=0; breakdown jsonb:='[]';
begin
  select creator_id into cid from order_creator_attributions where order_id=p_order_id;
  if cid is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(cid::text,91));
  select * into a from order_creator_attributions where order_id=p_order_id for update;
  select * into o from orders where id=p_order_id for update;
  select count(*),sum(charged_product_cents),sum(charged_discount_cents) into item_count,gross_sum,discount_sum
    from order_items where order_id=p_order_id;
  if item_count=0 or gross_sum is distinct from o.subtotal_cents::bigint or discount_sum is distinct from o.discount_cents::bigint then
    holds:=array_append(holds,'Product allocations need reconciliation');
  end if;
  for i in select * from order_items where order_id=p_order_id loop
    if i.charged_product_cents is null or i.charged_discount_cents is null then
      holds:=array_append(holds,'Missing charged product snapshot'); continue;
    end if;
    net:=i.charged_product_cents-i.charged_discount_cents;
    select coalesce(sum(quantity),0) into returned_qty from returns
      where order_item_id=i.id and status in ('received','refunded');
    returned_qty:=least(returned_qty,i.quantity);
    if returned_qty>0 and exists(select 1 from order_refund_items where order_item_id=i.id and return_id is null) then
      holds:=array_append(holds,'Link overlapping refund and return before approval');
    end if;
    -- A linked refund and the returned goods remove the same revenue, not twice.
    select coalesce(sum(ri.product_amount_cents) filter (where ri.return_id is null),0),
      coalesce(sum(ri.product_amount_cents) filter (where ri.return_id is not null),0)
      into refunds,returned_refunds from order_refund_items ri join order_refunds r on r.id=ri.refund_id
      where ri.order_item_id=i.id;
    removed:=least(net, greatest(round(net::numeric*returned_qty/i.quantity),returned_refunds)+refunds);
    line_revenue:=net-removed;
    revenue:=revenue+line_revenue;
    -- Per-line rate snapshotted at checkout (affiliate sale mode, 0135);
    -- lines from before that fall back to the attribution's own rate.
    line_bps:=coalesce(i.creator_commission_bps,a.commission_bps);
    weighted:=weighted+line_revenue*line_bps;
    breakdown:=breakdown||jsonb_build_object('order_item_id',i.id,'rate_bps',line_bps,'revenue_cents',line_revenue);
    if i.unit_cost_cents_snapshot is null then missing:=true;
    else
      costs:=costs+i.unit_cost_cents_snapshot*greatest(0,i.quantity-coalesce((select sum(quantity) from returns where order_item_id=i.id and restocked_at is not null),0));
    end if;
  end loop;
  if exists(select 1 from returns where order_id=p_order_id and status in ('requested','approved')) then
    holds:=array_append(holds,'Open return request');
  end if;
  if exists(select 1 from returns where order_id=p_order_id and order_item_id is null and status<>'rejected') then
    holds:=array_append(holds,'Return items need reconciliation');
    if exists(select 1 from returns where order_id=p_order_id and order_item_id is null and status in ('received','refunded')) then revenue:=0; end if;
  end if;
  if exists(select 1 from order_refunds where order_id=p_order_id and not allocation_complete) then
    holds:=array_append(holds,'Refund allocation needed'); revenue:=0;
  end if;
  if coalesce((select sum(amount_cents) from payments where order_id=p_order_id and status in ('captured','partially_refunded','refunded') and captured_at is not null),0)<o.total_cents then
    holds:=array_append(holds,'Payment or COD collection not confirmed');
  end if;
  select max(delivered_at) into delivery from shipments where order_id=p_order_id and status='delivered';
  if delivery is null or exists(select 1 from shipments where order_id=p_order_id and status<>'delivered') then
    holds:=array_append(holds,'Delivery not confirmed');
  end if;
  if a.hold_days is null then holds:=array_append(holds,'Commission hold period not configured');
  elsif delivery is not null then
    eligible:=delivery+make_interval(days=>a.hold_days);
    if now()<eligible then holds:=array_append(holds,'Return hold period has not ended'); end if;
  end if;
  if o.status in ('cancelled','failed','refunded') or exists(select 1 from shipments where order_id=p_order_id and status in ('failed','returned_to_sender')) then
    revenue:=0;
  end if;
  -- revenue is zeroed above for cancelled/unreconciled orders, which zeroes
  -- the commission too. Otherwise each line earns at its own rate; for an
  -- order whose lines all use the attribution's rate this is exactly the
  -- old round(revenue * commission_bps / 10000).
  earned:=case when revenue<=0 then 0 else round(greatest(0,weighted)/10000) end;
  next_status:=case when earned=0 then 'REVERSED'
    when cardinality(holds)>0 then 'PENDING'
    when a.paid_cents>=earned then 'PAID'
    when a.approved_at is not null and earned<=a.earned_cents then 'APPROVED'
    else 'PENDING' end;
  if earned<>a.earned_cents or revenue<>a.product_revenue_cents then
    insert into creator_commission_entries(order_id,revision,amount_cents,revenue_cents,reason)
      values(p_order_id,a.revision+1,earned-a.earned_cents,revenue,
        case when earned<a.earned_cents then 'Revenue reversal' else 'Order recalculation' end);
    a.revision:=a.revision+1;
  end if;
  update order_creator_attributions set earned_cents=earned,product_revenue_cents=revenue,cogs_cents=costs,
    missing_cost=missing or item_count=0,hold_reasons=holds,
    rate_breakdown=breakdown,
    effective_commission_bps=case when revenue>0 then round(weighted/revenue,2) else null end,eligible_at=eligible,status=next_status,revision=a.revision,
    approved_at=case when next_status in ('PENDING','REVERSED') then null else approved_at end,
    approved_by=case when next_status in ('PENDING','REVERSED') then null else approved_by end,
    updated_at=now() where order_id=p_order_id;
end $$;

revoke all on function reconcile_creator_order(uuid) from public, anon, authenticated;
grant execute on function reconcile_creator_order(uuid) to service_role;
