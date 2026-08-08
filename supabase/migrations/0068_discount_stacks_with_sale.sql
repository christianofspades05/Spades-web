-- Lets a specific discount code (e.g. Welcome, Abandoned Cart) apply on top
-- of an active store-wide automatic sale instead of replacing it — never
-- meaningful for automatic discounts themselves, and deliberately never
-- extended to collection-scoped sales (e.g. Clearance), which should never
-- stack with anything.
alter table discounts
  add column stacks_with_sale boolean not null default false;
