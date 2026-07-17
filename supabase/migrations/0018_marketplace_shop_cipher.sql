-- TikTok Shop's Open API requires a separate `shop_cipher` value (fetched
-- from the "authorized shops" endpoint after OAuth) on top of the shop id —
-- it's not the same thing, and reusing shop id in its place fails every
-- signed request with "Invalid shop_cipher" (error code 106011). This column
-- holds that value; external_shop_id keeps holding the actual shop id.
alter table marketplace_connections
  add column if not exists shop_cipher text;
