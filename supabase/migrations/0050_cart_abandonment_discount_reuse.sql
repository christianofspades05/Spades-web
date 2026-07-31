-- Lets the abandoned-cart email sequence hand out one consistent discount
-- code across its whole run instead of minting a brand-new one at every
-- step — a 24h and 48h email are the same "flow" from the customer's
-- perspective, so they should show the same code, not two different ones.
-- Set once, the first time any step mints a code for this cart; later
-- steps reuse it instead of minting again (see api/cron/abandoned-cart.ts).
alter table carts
  add column abandoned_cart_discount_id uuid references discounts (id) on delete set null;
