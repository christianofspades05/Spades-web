-- Lets a guest/customer cart carry an applied discount code before checkout
-- exists. Redemption (incrementing discounts.times_used) still only happens
-- at actual order placement — src/server/checkout is still design-notes-only
-- — this just lets the cart preview the discounted total.
alter table carts add column discount_id uuid references discounts (id) on delete set null;
