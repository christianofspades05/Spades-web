-- "Generate Different Basket" was found to alternate between exactly two
-- baskets on repeated regenerates (1st/3rd generation identical, 2nd/4th
-- identical) — the hard-exclude added in 0103 only remembered the single
-- most recent draft, so a product aged back into eligibility the moment it
-- was no longer the literal last thing shown. This column gives each shift
-- a small sliding-window memory (see ROTATION_MEMORY_GENERATIONS,
-- server/admin/live-planner.ts) spanning the last few regenerates instead
-- of just one, so a regenerate streak shows real variety before anything
-- can repeat.
alter table live_shifts
  add column recently_shown_product_ids jsonb not null default '[]'::jsonb;
