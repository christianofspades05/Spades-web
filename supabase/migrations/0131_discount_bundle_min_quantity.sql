-- -----------------------------------------------------------------------------
-- Bundle deals: an automatic, store-wide discount that only kicks in once
-- the cart holds at least `min_quantity` eligible items (e.g. "buy 3, get an
-- extra 10% off"). Null on every other discount. It's never shown as a
-- product's sale price (one item alone doesn't qualify) — it only applies in
-- the cart, on top of any active store sale. See appliedDiscountFor in
-- src/server/cart/discount.ts.
-- -----------------------------------------------------------------------------
alter table discounts
  add column min_quantity integer
  check (min_quantity is null or min_quantity >= 2);

-- d.* is expanded when a view is created, so the view has to be rebuilt to
-- pick up the new column (create or replace can't insert a column before
-- `status`). Same definition as 0119_discounts_with_status_view.sql.
drop view discounts_with_status;

create view discounts_with_status as
select
  d.*,
  case
    when not d.is_active then 'inactive'
    when d.starts_at is not null and d.starts_at > now() then 'scheduled'
    when (d.ends_at is not null and d.ends_at < now())
      or (d.max_uses is not null and d.times_used >= d.max_uses) then 'expired'
    else 'active'
  end as status
from discounts d;
