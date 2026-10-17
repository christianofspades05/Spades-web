-- First-click Facebook ad attribution (fbclid). Captured client-side on
-- landing (see src/lib/analytics/fbclid.ts), threaded through place-order
-- into checkout_reservations, and must also be copied into orders by
-- mint_checkout_order for the online-payment path (same reason
-- customer_notes needed the same treatment in 0065_order_customer_notes.sql)
-- — otherwise an order paid via Xendit/PayPal would silently lose it.
alter table checkout_reservations add column fbclid text;
alter table orders add column fbclid text;

create or replace function mint_checkout_order(p_reservation_id uuid,p_payment jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r checkout_reservations%rowtype; o orders%rowtype; item jsonb; begin
  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text,92));
  select * into o from orders where source='storefront' and external_order_id=p_reservation_id::text;
  if o.id is not null then return jsonb_build_object('id',o.id,'orderNumber',o.order_number,'created',false); end if;
  select * into r from checkout_reservations where id=p_reservation_id for update;
  if r.id is null then raise exception 'Checkout reservation not found'; end if;
  insert into orders(customer_id,status,source,external_order_id,subtotal_cents,discount_cents,shipping_cents,total_cents,discount_id,
    shipping_address,is_cod,currency,brand,market_markup_percent,shipping_method,lalamove_info,customer_notes,has_pre_order_items,fbclid)
  values(r.customer_id,'paid','storefront',r.id::text,r.subtotal_cents,r.discount_cents,r.shipping_cents,r.total_cents,r.discount_id,
    r.shipping_address,false,r.currency,r.brand,r.market_markup_percent,r.shipping_method,r.lalamove_info,r.customer_notes,
    exists(select 1 from jsonb_array_elements(r.items) x where (x->>'isPreOrder')::boolean),r.fbclid) returning * into o;
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
