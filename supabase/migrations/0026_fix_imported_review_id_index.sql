-- The partial index (WHERE imported_review_id IS NOT NULL) isn't usable as
-- an ON CONFLICT target for upserts — Postgres only infers a partial index
-- when the INSERT's own WHERE predicate matches exactly, which a simple
-- `ON CONFLICT (imported_review_id)` doesn't provide. A plain unique index
-- behaves the same for our purposes anyway: NULL is already treated as
-- distinct from other NULLs in a standard unique index, so organic reviews
-- (imported_review_id always NULL) still never collide with each other.
drop index if exists reviews_imported_review_id_idx;

create unique index if not exists reviews_imported_review_id_idx
  on reviews (imported_review_id);
