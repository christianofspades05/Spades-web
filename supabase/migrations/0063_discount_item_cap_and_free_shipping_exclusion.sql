-- Two new per-discount behaviors: capping a percentage/fixed_amount
-- discount to only the N highest-priced units in a cart (rather than
-- always discounting every eligible unit), and excluding a code from ever
-- waiving the free-shipping threshold. Both null/false by default, so
-- every existing discount keeps behaving exactly as it does today.
alter table discounts add column max_discounted_items integer;
alter table discounts add column excludes_free_shipping boolean not null default false;
