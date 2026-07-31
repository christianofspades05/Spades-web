-- The admin Orders page's Fulfilled/Unfulfilled filter used to fetch every
-- shipment's order_id into memory and pass them as a REST .in()/.not(in)
-- filter — once the store had ~3,000+ shipments, that filter's serialized
-- id list blew past Supabase's (Cloudflare-fronted) request-URL length
-- limit and the page failed outright with "414 Request-URI Too Large".
-- has_shipment is a plain boolean, so the filter is now a simple equality
-- check with no id list involved.
alter table orders add column has_shipment boolean not null default false;

update orders set has_shipment = true
where id in (select distinct order_id from shipments);

-- Shipments are never deleted in this app (confirmed: no DELETE on
-- shipments anywhere in the codebase), so only INSERT needs to flip this —
-- there's no path that would need it flipped back to false.
create or replace function set_order_has_shipment()
returns trigger
language plpgsql
as $$
begin
  update orders set has_shipment = true where id = new.order_id;
  return new;
end;
$$;

drop trigger if exists shipments_set_order_has_shipment on shipments;
create trigger shipments_set_order_has_shipment
  after insert on shipments
  for each row
  execute function set_order_has_shipment();
