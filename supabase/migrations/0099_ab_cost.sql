-- AB Cost — manufacturing cost from the staff's other (sister) manufacturing
-- company, "AB". Distinct from the existing cost_cents (what Spades pays
-- AB / books as its own COGS) — AB Profit = cost_cents - ab_cost_cents,
-- i.e. AB's own margin on what it charges Spades. Mirrors cost_cents
-- exactly (nullable — not every product is AB-manufactured; non-negative).
alter table product_variants
  add column ab_cost_cents integer check (ab_cost_cents is null or ab_cost_cents >= 0);
