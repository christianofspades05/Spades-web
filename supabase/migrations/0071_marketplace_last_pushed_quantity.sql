alter table marketplace_product_mappings
  add column last_pushed_quantity integer;

comment on column marketplace_product_mappings.last_pushed_quantity is
  'Quantity actually sent in the last successful push_inventory call (already stock-buffer-adjusted) — shown read-only on the admin Inventory page as that channel''s last-known stock, not live-fetched from the marketplace.';
