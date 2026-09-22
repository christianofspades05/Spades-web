-- Correction to 0093: a self-referencing replaced_item_id can't coexist
-- with the (shift_id, recommended_order) unique constraint (a replacement
-- occupies the same slot, not a new one). Replacing a product now updates
-- the existing item in place — original_product_id preserves what the
-- algorithm actually recommended so the "did human overrides beat the
-- algorithm" comparison this data is for stays possible.
alter table live_basket_items drop column replaced_item_id;
alter table live_basket_items add column original_product_id uuid references products(id);
