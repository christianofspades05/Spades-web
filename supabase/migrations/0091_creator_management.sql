-- Prospective creator accounting. No historical attribution or cost backfill.
-- All money is PHP centavos; charged currency remains on payments.
create table creators (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  email text, social_url text, notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table creator_discount_assignments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creators(id),
  discount_id uuid not null unique references discounts(id),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  hold_days integer default 14 check (hold_days between 0 and 365),
  brand text not null default 'spades' check (brand in ('spades','ysrael','aspire365')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Each order/reservation stores its own agreement version. Assignment changes
-- apply prospectively; ownership never changes. No second discount system.
alter table checkout_reservations add column creator_snapshot jsonb;
alter table order_items
  add column charged_product_cents integer check (charged_product_cents >= 0),
  add column charged_discount_cents integer check (charged_discount_cents >= 0 and charged_discount_cents <= charged_product_cents),
  add column unit_cost_cents_snapshot integer check (unit_cost_cents_snapshot >= 0),
  add column external_variant_id text;

create table order_creator_attributions (
  order_id uuid primary key references orders(id),
  creator_id uuid not null references creators(id),
  assignment_id uuid not null references creator_discount_assignments(id),
  code_snapshot text not null,
  commission_bps integer not null check (commission_bps between 0 and 10000),
  hold_days integer default 14 check (hold_days between 0 and 365),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PAID','REVERSED')),
  product_revenue_cents integer not null default 0,
  earned_cents integer not null default 0 check (earned_cents >= 0),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  cogs_cents integer not null default 0,
  missing_cost boolean not null default true,
  hold_reasons text[] not null default '{}',
  eligible_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references staff_users(id),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index creator_attribution_creator_idx on order_creator_attributions(creator_id,created_at);
create table creator_commission_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references order_creator_attributions(order_id),
  revision integer not null,
  amount_cents integer not null,
  revenue_cents integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(order_id,revision)
);
create table creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references creators(id),
  reference text not null check (length(trim(reference)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  staff_user_id uuid not null references staff_users(id),
  created_at timestamptz not null default now(),
  unique(creator_id,reference)
);
create table creator_payout_allocations (
  payout_id uuid not null references creator_payouts(id),
  order_id uuid not null references order_creator_attributions(order_id),
  amount_cents integer not null,
  primary key(payout_id,order_id)
);
create table creator_expenses (
  id uuid primary key,
  creator_id uuid not null references creators(id),
  kind text not null check (kind in ('content_fee','gift','other')),
  description text not null,
  amount_cents integer not null check (amount_cents >= 0),
  variant_id uuid references product_variants(id),
  quantity integer check (quantity > 0),
  unit_cost_cents integer,
  incurred_at timestamptz not null default now(),
  paid_at timestamptz,
  staff_user_id uuid not null references staff_users(id),
  created_at timestamptz not null default now()
);
create index creator_expenses_creator_idx on creator_expenses(creator_id,incurred_at);

-- Financial refunds are separate from physical returns. A return can be linked
-- to a refund line so its revenue removal is counted only once.
create table order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_id uuid references payments(id),
  source text not null,
  external_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  occurred_at timestamptz not null default now(),
  allocation_complete boolean not null default false,
  created_at timestamptz not null default now(),
  unique(source,external_id)
);
create table order_refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references order_refunds(id),
  order_item_id uuid not null references order_items(id),
  return_id uuid references returns(id),
  product_amount_cents integer not null check (product_amount_cents >= 0),
  unique(refund_id,order_item_id)
);
create index order_refunds_order_idx on order_refunds(order_id);
create index order_refund_items_item_idx on order_refund_items(order_item_id);
alter table returns add column restocked_at timestamptz;

-- No browser access, including staff browser clients. Server functions enforce
-- roles and all mutation RPCs verify the staff row again within the transaction.
do $$ declare t text; begin
  foreach t in array array['creators','creator_discount_assignments','order_creator_attributions',
    'creator_commission_entries','creator_payouts','creator_payout_allocations','creator_expenses',
    'order_refunds','order_refund_items'] loop
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on %I from anon, authenticated',t);
    execute format('grant all on %I to service_role',t);
  end loop;
end $$;

create function creator_checkout_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
declare s jsonb; begin
  if TG_OP='UPDATE' then
    new.creator_snapshot := old.creator_snapshot;
    return new;
  end if;
  new.creator_snapshot := null;
  select jsonb_build_object('creator_id',a.creator_id,'assignment_id',a.id,
    'code',d.code,'commission_bps',a.commission_bps,'hold_days',a.hold_days)
    into s from creator_discount_assignments a join creators c on c.id=a.creator_id
    join discounts d on d.id=a.discount_id
    where a.discount_id=new.discount_id and a.brand=new.brand and a.is_active and c.is_active
      and d.kind='code' and new.discount_cents>0;
  new.creator_snapshot:=s;
  return new;
end $$;
create trigger creator_reservation_snapshot before insert or update on checkout_reservations for each row execute function creator_checkout_snapshot();

create function creator_capture_attribution() returns trigger language plpgsql security definer set search_path=public as $$
declare snapshot jsonb;
begin
  if new.source<>'storefront' then return new; end if;
  if new.external_order_id is not null then
    select creator_snapshot into snapshot from checkout_reservations where id::text=new.external_order_id;
  else
    select jsonb_build_object('creator_id',a.creator_id,'assignment_id',a.id,'code',d.code,
      'commission_bps',a.commission_bps,'hold_days',a.hold_days) into snapshot
      from creator_discount_assignments a join creators c on c.id=a.creator_id join discounts d on d.id=a.discount_id
      where a.discount_id=new.discount_id and a.brand=new.brand and a.is_active and c.is_active and d.kind='code' and new.discount_cents>0;
  end if;
  if snapshot is not null then
    insert into order_creator_attributions(order_id,creator_id,assignment_id,code_snapshot,commission_bps,hold_days)
    values(new.id,(snapshot->>'creator_id')::uuid,(snapshot->>'assignment_id')::uuid,
      snapshot->>'code',(snapshot->>'commission_bps')::integer,(snapshot->>'hold_days')::integer);
  end if;
  return new;
end $$;
create trigger creator_capture_order after insert on orders for each row execute function creator_capture_attribution();

-- Called by triggers AND before every approval/payout. Locking the creator
-- serializes order reconciliation with creator-wide payout/offset allocation.
create function reconcile_creator_order(p_order_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare a order_creator_attributions%rowtype; o orders%rowtype; i record;
  cid uuid; revenue bigint:=0; earned integer; costs bigint:=0; missing boolean:=false;
  holds text[]:='{}'; delivery timestamptz; eligible timestamptz; next_status text;
  net integer; returned_qty integer; removed bigint; refunds bigint; returned_refunds bigint;
  gross_sum bigint; discount_sum bigint; item_count integer;
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
    revenue:=revenue+net-removed;
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
  earned:=round(greatest(0,revenue)*a.commission_bps::numeric/10000);
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
    missing_cost=missing or item_count=0,hold_reasons=holds,eligible_at=eligible,status=next_status,revision=a.revision,
    approved_at=case when next_status in ('PENDING','REVERSED') then null else approved_at end,
    approved_by=case when next_status in ('PENDING','REVERSED') then null else approved_by end,
    updated_at=now() where order_id=p_order_id;
end $$;

create function creator_reconcile_trigger() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_TABLE_NAME='orders' then perform reconcile_creator_order(new.id);
  else
    if TG_OP<>'DELETE' then perform reconcile_creator_order(new.order_id); end if;
    if TG_OP='DELETE' then perform reconcile_creator_order(old.order_id); end if;
  end if;
  return null;
end $$;
create trigger creator_reconcile_order after update on orders for each row execute function creator_reconcile_trigger();
create trigger creator_reconcile_items after insert or update or delete on order_items for each row execute function creator_reconcile_trigger();
create trigger creator_reconcile_payments after insert or update or delete on payments for each row execute function creator_reconcile_trigger();
create trigger creator_reconcile_shipments after insert or update or delete on shipments for each row execute function creator_reconcile_trigger();
create trigger creator_reconcile_returns after insert or update or delete on returns for each row execute function creator_reconcile_trigger();
create trigger creator_reconcile_refunds after insert or update on order_refunds for each row execute function creator_reconcile_trigger();

create function preserve_delivery_timestamp() returns trigger language plpgsql as $$
begin
  if old.delivered_at is not null then new.delivered_at:=old.delivered_at; end if;
  return new;
end $$;
create trigger preserve_shipment_delivery before update on shipments for each row execute function preserve_delivery_timestamp();

-- Single, transactional admin boundary. Input validation is repeated here for
-- financial invariants; only the service role may call this RPC.
create function creator_admin_command(p_staff_id uuid,p_action text,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare staff staff_users%rowtype; cid uuid; result uuid; a record; d discounts%rowtype;
  ref text; total bigint; line jsonb; oid uuid; item order_items%rowtype; v product_variants%rowtype;
  rid uuid; ret returns%rowtype; amount integer; existing order_refunds%rowtype;
begin
  select * into staff from staff_users where id=p_staff_id and is_active;
  if staff.id is null or staff.role not in ('super_admin','admin','manager') then raise exception 'Not authorized'; end if;
  if p_action in ('approve','payout','collect_cod','record_refund','receive_return','resolve_return') and staff.role not in ('super_admin','admin') then raise exception 'Administrator required'; end if;
  cid:=nullif(p_data->>'creatorId','')::uuid;
  if cid is not null then perform pg_advisory_xact_lock(hashtextextended(cid::text,91)); end if;
  if p_action='save_creator' then
    if cid is null then
      insert into creators(name,email,social_url,notes) values(p_data->>'name',nullif(p_data->>'email',''),nullif(p_data->>'socialUrl',''),p_data->>'notes') returning id into result;
    else
      update creators set name=p_data->>'name',email=nullif(p_data->>'email',''),social_url=nullif(p_data->>'socialUrl',''),notes=p_data->>'notes',is_active=(p_data->>'isActive')::boolean,updated_at=now()
        where id=cid returning id into result;
    end if;
  elsif p_action='assign_code' then
    select * into d from discounts where id=(p_data->>'discountId')::uuid for update;
    if d.id is null or d.kind<>'code' or d.email_automation_id is not null then raise exception 'Choose a regular discount code'; end if;
    if exists(select 1 from creator_discount_assignments where discount_id=d.id and creator_id<>cid) then raise exception 'Codes cannot be reassigned to another creator'; end if;
    insert into creator_discount_assignments(creator_id,discount_id,commission_bps,hold_days,brand)
      values(cid,d.id,(p_data->>'commissionBps')::integer,(p_data->>'holdDays')::integer,p_data->>'brand')
      on conflict(discount_id) do update set commission_bps=excluded.commission_bps,hold_days=excluded.hold_days,is_active=(p_data->>'isActive')::boolean
      returning id into result;
  elsif p_action='reconcile' then
    for a in select order_id from order_creator_attributions where creator_id=cid order by order_id loop perform reconcile_creator_order(a.order_id); end loop;
    result:=cid;
  elsif p_action='approve' then
    oid:=(p_data->>'orderId')::uuid;
    perform reconcile_creator_order(oid);
    select * into a from order_creator_attributions where order_id=oid for update;
    if a.order_id is null or cardinality(a.hold_reasons)>0 or a.earned_cents<=a.paid_cents then raise exception 'Order is not eligible for approval'; end if;
    update order_creator_attributions set status='APPROVED',approved_at=now(),approved_by=staff.id where order_id=oid;
    result:=oid;
  elsif p_action='payout' then
    ref:=trim(p_data->>'reference');
    select id into result from creator_payouts where creator_id=cid and reference=ref;
    if result is not null then return result; end if;
    for a in select order_id from order_creator_attributions where creator_id=cid order by order_id loop perform reconcile_creator_order(a.order_id); end loop;
    select coalesce(sum(earned_cents-paid_cents),0) into total from order_creator_attributions
      where creator_id=cid and (status='APPROVED' or paid_cents>earned_cents);
    if total<=0 or total is distinct from (p_data->>'expectedAmountCents')::bigint then raise exception 'Payout balance changed; refresh and review'; end if;
    insert into creator_payouts(creator_id,reference,amount_cents,staff_user_id) values(cid,ref,total,staff.id) returning id into result;
    insert into creator_payout_allocations(payout_id,order_id,amount_cents)
      select result,order_id,earned_cents-paid_cents from order_creator_attributions
      where creator_id=cid and (status='APPROVED' or paid_cents>earned_cents) and earned_cents<>paid_cents;
    update order_creator_attributions set paid_cents=earned_cents,status=case when earned_cents=0 then 'REVERSED' else 'PAID' end
      where creator_id=cid and (status='APPROVED' or paid_cents>earned_cents);
  elsif p_action='expense' then
    result:=(p_data->>'id')::uuid;
    if exists(select 1 from creator_expenses where id=result) then return result; end if;
    amount:=(p_data->>'amountCents')::integer;
    if p_data->>'kind'='gift' then
      select * into v from product_variants where id=(p_data->>'variantId')::uuid;
      if v.id is null or v.cost_cents is null then raise exception 'Set this variant cost before recording a gift'; end if;
      if (p_data->>'quantity')::integer<=0 then raise exception 'Quantity must be positive'; end if;
      amount:=v.cost_cents*(p_data->>'quantity')::integer;
      if not reserve_variant_stock(v.id,(p_data->>'quantity')::integer,'main','creator_gift',result) then raise exception 'Not enough available stock'; end if;
      perform commit_variant_stock(v.id,(p_data->>'quantity')::integer,'main','creator_gift',result);
    end if;
    insert into creator_expenses(id,creator_id,kind,description,amount_cents,variant_id,quantity,unit_cost_cents,incurred_at,paid_at,staff_user_id)
      values(result,cid,p_data->>'kind',p_data->>'description',amount,v.id,case when v.id is not null then (p_data->>'quantity')::integer end,v.cost_cents,
        (p_data->>'incurredAt')::timestamptz,(p_data->>'paidAt')::timestamptz,staff.id);
  elsif p_action='expense_paid' then
    update creator_expenses set paid_at=coalesce(paid_at,now()) where id=(p_data->>'expenseId')::uuid and creator_id=cid returning id into result;
  elsif p_action='request_return' then
    oid:=(p_data->>'orderId')::uuid;
    select * into item from order_items where id=(p_data->>'orderItemId')::uuid and order_id=oid;
    if item.id is null or (p_data->>'quantity')::integer<1 or (p_data->>'quantity')::integer+coalesce((select sum(quantity) from returns where order_item_id=item.id and status<>'rejected'),0)>item.quantity then raise exception 'Invalid return quantity'; end if;
    insert into returns(order_id,order_item_id,customer_id,reason,quantity,status)
      values(oid,item.id,(select customer_id from orders where id=oid),p_data->>'reason',(p_data->>'quantity')::integer,'requested') returning id into result;
  elsif p_action='resolve_return' then
    update returns set status='rejected',resolved_at=now() where id=(p_data->>'returnId')::uuid and status in ('requested','approved') returning id into result;
  elsif p_action='collect_cod' then
    oid:=(p_data->>'orderId')::uuid;
    perform 1 from orders where id=oid and is_cod and status not in ('cancelled','failed','refunded') for update;
    if not found then raise exception 'Not an active COD order'; end if;
    update payments set status='captured',captured_at=coalesce(captured_at,now()),provider_reference=p_data->>'reference'
      where order_id=oid and provider='cod' and status='pending';
    if not found and not exists(select 1 from payments where order_id=oid and provider='cod' and status='captured') then raise exception 'COD payment record missing'; end if;
    result:=oid;
  elsif p_action='record_refund' then
    oid:=(p_data->>'orderId')::uuid;
    perform 1 from orders where id=oid for update;
    if not found then raise exception 'Order not found'; end if;
    select * into existing from order_refunds where source=coalesce(p_data->>'source','manual') and external_id=p_data->>'reference';
    if existing.id is not null then
      if existing.order_id<>oid or existing.amount_cents<>(p_data->>'amountCents')::integer then raise exception 'Refund reference already used'; end if;
      if existing.allocation_complete then return existing.id; end if;
    end if;
    amount:=(p_data->>'amountCents')::integer;
    if (p_data->>'shippingCents')::integer+coalesce((select sum(shipping_cents) from order_refunds where order_id=oid),0)>(select shipping_cents from orders where id=oid)
      or (p_data->>'taxCents')::integer+coalesce((select sum(tax_cents) from order_refunds where order_id=oid),0)>(select tax_cents from orders where id=oid) then raise exception 'Refund exceeds shipping or tax charged'; end if;
    if amount+coalesce((select sum(amount_cents) from order_refunds where order_id=oid and id is distinct from existing.id),0)>(select total_cents from orders where id=oid) then raise exception 'Refund exceeds order total'; end if;
    if existing.id is null then
      insert into order_refunds(order_id,source,external_id,amount_cents,shipping_cents,tax_cents,occurred_at)
        values(oid,coalesce(p_data->>'source','manual'),p_data->>'reference',amount,(p_data->>'shippingCents')::integer,(p_data->>'taxCents')::integer,(p_data->>'occurredAt')::timestamptz) returning id into result;
    else
      result:=existing.id;
      update order_refunds set shipping_cents=(p_data->>'shippingCents')::integer,tax_cents=(p_data->>'taxCents')::integer where id=result;
    end if;
    total:=(p_data->>'shippingCents')::integer+(p_data->>'taxCents')::integer;
    for line in select * from jsonb_array_elements(p_data->'items') loop
      select * into item from order_items where id=(line->>'orderItemId')::uuid and order_id=oid;
      if item.id is null then raise exception 'Refund item does not belong to order'; end if;
      rid:=nullif(line->>'returnId','')::uuid;
      if rid is not null and not exists(select 1 from returns where id=rid and order_id=oid and order_item_id=item.id) then raise exception 'Return does not match refund item'; end if;
      if (line->>'amountCents')::integer+coalesce((select sum(product_amount_cents) from order_refund_items where order_item_id=item.id),0)>coalesce(item.charged_product_cents-item.charged_discount_cents,item.line_total_cents) then raise exception 'Refund exceeds item value'; end if;
      insert into order_refund_items(refund_id,order_item_id,return_id,product_amount_cents)
        values(result,item.id,rid,(line->>'amountCents')::integer);
      total:=total+(line->>'amountCents')::integer;
    end loop;
    if total<>amount then raise exception 'Refund allocations must equal refund total'; end if;
    update order_refunds set allocation_complete=true where id=result;
  elsif p_action='receive_return' then
    select * into ret from returns where id=(p_data->>'returnId')::uuid for update;
    if ret.id is null or ret.status='rejected' then raise exception 'Return not found or rejected'; end if;
    select * into item from order_items where id=(p_data->>'orderItemId')::uuid and order_id=ret.order_id;
    if item.id is null or ret.quantity>item.quantity then raise exception 'Invalid returned item'; end if;
    if coalesce((select sum(quantity) from returns where order_item_id=item.id and status in ('received','refunded') and id<>ret.id),0)+ret.quantity>item.quantity then raise exception 'Returned quantity exceeds purchased quantity'; end if;
    if (p_data->>'restock')::boolean and ret.restocked_at is null then
      if item.variant_id is null then raise exception 'Cannot restock a deleted variant'; end if;
      perform restock_variant_stock(item.variant_id,ret.quantity,'main','return',ret.id);
    end if;
    update returns set order_item_id=item.id,status=case when status='refunded' then status else 'received'::return_status end,
      restocked_at=case when (p_data->>'restock')::boolean then coalesce(restocked_at,now()) else restocked_at end,
      resolved_at=coalesce(resolved_at,now()) where id=ret.id;
    result:=ret.id;
  else raise exception 'Unknown creator action';
  end if;
  if result is null then raise exception 'Record not found'; end if;
  insert into activity_logs(actor_type,staff_user_id,action,entity_type,entity_id,metadata)
    values('staff',staff.id,'creator.'||p_action,'creators',result,p_data);
  return result;
end $$;

revoke all on function creator_checkout_snapshot(),creator_capture_attribution(),creator_reconcile_trigger(),preserve_delivery_timestamp(),reconcile_creator_order(uuid),creator_admin_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reconcile_creator_order(uuid),creator_admin_command(uuid,text,jsonb) to service_role;

-- Payment confirmation must finish all order writes or none of them. Both
-- PayPal confirmation paths and Xendit retries call this same transaction.
create function mint_checkout_order(p_reservation_id uuid,p_payment jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r checkout_reservations%rowtype; o orders%rowtype; item jsonb; begin
  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text,92));
  select * into o from orders where source='storefront' and external_order_id=p_reservation_id::text;
  if o.id is not null then return jsonb_build_object('id',o.id,'orderNumber',o.order_number,'created',false); end if;
  select * into r from checkout_reservations where id=p_reservation_id for update;
  if r.id is null then raise exception 'Checkout reservation not found'; end if;
  insert into orders(customer_id,status,source,external_order_id,subtotal_cents,discount_cents,shipping_cents,total_cents,discount_id,
    shipping_address,is_cod,currency,brand,market_markup_percent,shipping_method,lalamove_info,customer_notes,has_pre_order_items)
  values(r.customer_id,'paid','storefront',r.id::text,r.subtotal_cents,r.discount_cents,r.shipping_cents,r.total_cents,r.discount_id,
    r.shipping_address,false,r.currency,r.brand,r.market_markup_percent,r.shipping_method,r.lalamove_info,r.customer_notes,
    exists(select 1 from jsonb_array_elements(r.items) x where (x->>'isPreOrder')::boolean)) returning * into o;
  for item in select * from jsonb_array_elements(r.items) loop
    insert into order_items(order_id,variant_id,product_name_snapshot,variant_label_snapshot,sku_snapshot,unit_price_cents,quantity,
      line_subtotal_cents,line_discount_cents,line_total_cents,is_pre_order,charged_product_cents,charged_discount_cents,unit_cost_cents_snapshot)
    values(o.id,(item->>'variantId')::uuid,item->>'productNameSnapshot',item->>'variantLabelSnapshot',item->>'skuSnapshot',
      (item->>'unitPriceCents')::integer,(item->>'quantity')::integer,(item->>'lineSubtotalCents')::integer,
      (item->>'lineDiscountCents')::integer,(item->>'lineTotalCents')::integer,coalesce((item->>'isPreOrder')::boolean,false),
      (item->>'chargedProductCents')::integer,(item->>'chargedDiscountCents')::integer,(item->>'unitCostCentsSnapshot')::integer);
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
revoke all on function mint_checkout_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function mint_checkout_order(uuid,jsonb) to service_role;

-- Existing sales/profit reports consume this projection so the new refund
-- journal is not an isolated second financial system. Linked returns are not
-- added again; physical-return counts still come from returns.
create view order_financial_refunds with (security_invoker=true) as
  select r.order_id,r.amount_cents as refund_amount_cents,'refunded'::text as status from order_refunds r
  union all
  -- Marketplace adapters currently repeat a return's whole refund amount on
  -- every normalized line. Collapse by the platform return ID before summing.
  select r.order_id,max(r.refund_amount_cents) as refund_amount_cents,'refunded'::text
    from returns r where r.status='refunded'
    and not exists(select 1 from order_refund_items ri where ri.return_id=r.id)
    group by r.order_id,coalesce(split_part(r.external_return_id,':',1),r.id::text);
revoke all on order_financial_refunds from public,anon,authenticated;
grant select on order_financial_refunds to service_role;

-- A verified gateway refund immediately blocks payout until staff allocate it
-- to products/shipping/tax. Never guess that a refund is product revenue.
create function record_gateway_refund(p_gateway text,p_reference text,p_refund_id text,p_currency text,p_minor_amount integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare pay payments%rowtype; existing order_refunds%rowtype; oid uuid; cid uuid; amount integer; rid uuid; refunded bigint;
begin
  if p_gateway not in ('paypal','xendit') or p_minor_amount<=0 then raise exception 'Invalid gateway refund'; end if;
  select * into strict pay from payments where (provider_reference=p_reference or raw_payload->>'payment_id'=p_reference or raw_payload->>'payment_request_id'=p_reference)
    and ((p_gateway='paypal' and provider='paypal') or (p_gateway='xendit' and provider not in ('paypal','cod')));
  oid:=pay.order_id;
  select creator_id into cid from order_creator_attributions where order_id=oid;
  if cid is not null then perform pg_advisory_xact_lock(hashtextextended(cid::text,91)); end if;
  perform 1 from orders where id=oid for update;
  if p_currency<>coalesce(pay.charged_currency,'PHP') then raise exception 'Refund currency differs from captured payment'; end if;
  amount:=case when pay.charged_currency is null then p_minor_amount
    else round(p_minor_amount::numeric*pay.amount_cents/nullif(pay.charged_amount_cents,0)) end;
  if amount is null or amount<=0 then raise exception 'Cannot convert refund to PHP'; end if;
  select * into existing from order_refunds where source=p_gateway and external_id=p_refund_id;
  if existing.id is not null then
    if existing.order_id<>oid or existing.amount_cents<>amount then raise exception 'Refund identity conflict'; end if;
    return existing.id;
  end if;
  select coalesce(sum(amount_cents),0) into refunded from order_refunds where order_id=oid;
  if refunded+amount>(select total_cents from orders where id=oid) then raise exception 'Refund exceeds order balance'; end if;
  insert into order_refunds(order_id,payment_id,source,external_id,amount_cents) values(oid,pay.id,p_gateway,p_refund_id,amount) returning id into rid;
  update payments set status=case when refunded+amount>=pay.amount_cents then 'refunded'::payment_status else 'partially_refunded'::payment_status end where id=pay.id;
  return rid;
end $$;
revoke all on function record_gateway_refund(text,text,text,text,integer) from public,anon,authenticated;
grant execute on function record_gateway_refund(text,text,text,text,integer) to service_role;
