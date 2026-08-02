-- Per-market shipping override, replacing the flat INTERNATIONAL_SHIPPING_USD
-- fee for whichever countries a market covers. All nullable — a market with
-- no shipping override set keeps using the existing flat international fee,
-- so nothing changes for markets created before this feature.
alter table markets add column shipping_name text;
alter table markets add column shipping_price_cents integer;

-- Free shipping trigger: at most one of these is meaningfully set at a time
-- (the admin form only lets staff choose one mode), but both are checked as
-- an OR at checkout in case a market ever has both — whichever condition is
-- met first waives the shipping fee.
alter table markets add column free_shipping_min_subtotal_cents integer;
alter table markets add column free_shipping_min_items integer;
