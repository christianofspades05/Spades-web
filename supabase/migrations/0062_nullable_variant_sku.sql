-- Duplicating a product now leaves each new variant's SKU blank (rather
-- than an auto-generated "-copy" suffix) so staff type a real one instead
-- of accidentally shipping/pushing a placeholder — see duplicateProduct in
-- server/admin/products.ts. Multiple NULLs don't violate the existing
-- unique constraint (Postgres never treats NULL as equal to NULL), so this
-- is safe alongside every other variant's real, unique SKU.
alter table product_variants alter column sku drop not null;
