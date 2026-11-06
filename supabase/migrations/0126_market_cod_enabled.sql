-- Cash on Delivery was hardcoded to the Philippines only (see
-- place-order.ts/payment.tsx). Lets staff enable it for a market's
-- countries instead — PH itself stays always-COD-eligible regardless of
-- this column, since it has no market row of its own (markets exist for
-- non-default-pricing countries, PH is the implicit baseline). Defaults to
-- false so every existing market keeps its current (online-payment-only)
-- behavior until a staff member opts one in explicitly.
alter table markets add column cod_enabled boolean not null default false;
