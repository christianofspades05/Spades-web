-- Platform-funded discounts/vouchers (e.g. Shopee's own voucher subsidy) are
-- never netted into discount_cents (seller-funded only, see NormalizedOrder.
-- discountCents' doc comment) but still explain the gap between
-- subtotal_cents + shipping_cents and total_cents on the order detail page.
-- Sourced directly from the marketplace's own voucher field (e.g. Shopee
-- escrow's voucher_from_shopee), never inferred by subtracting totals.
alter table orders
  add column platform_discount_cents integer not null default 0;
