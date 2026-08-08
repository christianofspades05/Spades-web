-- Lets staff photograph the package at rider pickup (Lalamove orders) and
-- email it to the customer as pickup confirmation. Public bucket, same
-- reasoning as storefront-sections (0031): the signed-upload-URL flow uses
-- the service-role admin client, which bypasses storage RLS entirely, so a
-- public bucket with no RLS policies is enough for the resulting URL to be
-- both uploadable by staff and viewable in the customer's email client.
insert into storage.buckets (id, name, public)
values ('shipment-photos', 'shipment-photos', true)
on conflict (id) do nothing;

alter table shipments add column pickup_photo_url text;
