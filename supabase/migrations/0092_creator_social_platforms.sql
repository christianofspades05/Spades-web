-- Split the single social_url field into per-platform URLs — staff manage
-- TikTok/Instagram/Facebook creators and want to record all three, not just
-- whichever one was filled in first. Preserve the one existing value (it
-- happened to be a Facebook link) before dropping the old column.
alter table creators
  add column tiktok_url text,
  add column instagram_url text,
  add column facebook_url text;
update creators set facebook_url = social_url where social_url is not null;
alter table creators drop column social_url;

create or replace function creator_admin_command(p_staff_id uuid,p_action text,p_data jsonb) returns uuid
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
      insert into creators(name,email,tiktok_url,instagram_url,facebook_url,notes)
        values(p_data->>'name',nullif(p_data->>'email',''),nullif(p_data->>'tiktokUrl',''),nullif(p_data->>'instagramUrl',''),nullif(p_data->>'facebookUrl',''),p_data->>'notes')
        returning id into result;
    else
      update creators set name=p_data->>'name',email=nullif(p_data->>'email',''),
        tiktok_url=nullif(p_data->>'tiktokUrl',''),instagram_url=nullif(p_data->>'instagramUrl',''),facebook_url=nullif(p_data->>'facebookUrl',''),
        notes=p_data->>'notes',is_active=(p_data->>'isActive')::boolean,updated_at=now()
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
