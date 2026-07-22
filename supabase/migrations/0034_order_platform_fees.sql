-- Marketplace platform fees (Shopee's commission/service/transaction fee and
-- withholding tax, etc.) that reduce the seller's payout for an order — a
-- different concept from discount_cents (a price reduction the customer
-- sees before paying), so kept as its own pair of columns rather than folded
-- into the existing discount field. total_cents keeps meaning "amount the
-- customer paid" everywhere (storefront checkout, every marketplace) so
-- existing revenue/sales analytics stay correct; platform_fees_cents is
-- purely informational, for seeing what you actually net after the
-- marketplace's cut.
alter table orders
  add column platform_fees_cents integer not null default 0,
  add column platform_fee_breakdown jsonb not null default '[]';
