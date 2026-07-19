-- Reviews imported from an external source (e.g. the old Shopify store's
-- Judge.me export) have no corresponding order in this system — order_id
-- was previously mandatory because every review here came from a real
-- order-triggered request flow (see src/server/reviews/public.ts). Postgres
-- treats NULL as distinct in the existing unique(order_id, product_id)
-- index, so multiple imported reviews (all with a NULL order_id) for the
-- same product don't collide with each other or with organic reviews.
alter table reviews
  alter column order_id drop not null;

alter table reviews
  add column if not exists imported_source text,
  add column if not exists imported_review_id text;

create unique index if not exists reviews_imported_review_id_idx
  on reviews (imported_review_id)
  where imported_review_id is not null;
