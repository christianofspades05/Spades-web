-- TikTok LIVE Product Planner: recommends and tracks the 12-product basket
-- for each 4-hour LIVE shift. Staff-only, same access model as
-- creator_management (0091) — no browser/anon access at all, every read
-- and write goes through a createServerFn using the service-role client.

create type live_shift_slot as enum ('10am_2pm', '6pm_10pm', '10pm_2am');
create type live_basket_category as enum ('proven', 'priority', 'inventory_push', 'test', 'seller_pick');
create type live_shift_status as enum ('draft', 'finalized', 'live', 'completed');
create type live_replacement_reason as enum (
  'viewer_request', 'low_engagement', 'product_sold_out', 'size_sold_out',
  'seller_judgment', 'management_request', 'other'
);

-- Manual per-product overrides the scoring engine reads before/alongside its
-- own computed factors. One row per product that's ever had a flag set
-- (not every product) — absence means every flag is at its default.
create table product_live_flags (
  product_id uuid primary key references products(id) on delete cascade,
  live_eligible boolean not null default true,
  manual_live_lock boolean not null default false,
  manual_priority boolean not null default false,
  anchor_product boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Single configurable-settings row for the whole planner — weights, slot
-- counts, rotation/cooldown rules. Every business rule lives here instead
-- of scattered hardcoded TS constants (the pattern every other admin
-- analytics page uses today, e.g. product-analytics.tsx's
-- RESTOCK_MIN_AVG_PER_DAY) — this feature specifically needs these tunable
-- without a redeploy, per the original request's architecture requirement.
-- The `((true))` unique index below is what actually enforces "exactly one
-- row" — a second insert violates it rather than needing app-level policing.
create table live_planner_config (
  id uuid primary key default gen_random_uuid(),
  basket_size integer not null default 12,
  slot_counts jsonb not null default '{
    "proven": 4, "priority": 3, "inventory_push": 2, "test": 2, "seller_pick": 1
  }',
  -- Per-category weight sets (0-100, need not sum to exactly 100 — the
  -- scoring engine normalizes). No "live_performance"/"recent_live_exposure"
  -- weights yet — there's no pin-history data to score on until this
  -- feature has run for a few weeks; add them back once that data exists.
  scoring_weights jsonb not null default '{
    "proven": {"velocity": 35, "inventoryHealth": 20, "sizeAvailability": 20, "momentum": 10, "daysOfStock": 10, "strategicPriority": 5},
    "priority": {"velocity": 10, "inventoryHealth": 15, "sizeAvailability": 15, "momentum": 10, "daysOfStock": 5, "strategicPriority": 45},
    "inventory_push": {"velocity": 15, "inventoryHealth": 15, "sizeAvailability": 20, "momentum": 5, "daysOfStock": 40, "strategicPriority": 5},
    "test": {"velocity": 15, "inventoryHealth": 15, "sizeAvailability": 20, "momentum": 20, "daysOfStock": 5, "strategicPriority": 25}
  }',
  new_product_protection_days integer not null default 7,
  max_test_appearances integer not null default 5,
  min_inventory integer not null default 5,
  min_size_health_score numeric not null default 0.4,
  max_consecutive_appearances integer not null default 3,
  -- Recent-exposure rotation penalty/bonus, in score points, keyed by how
  -- many days ago a product last appeared in any finalized basket.
  rotation_penalty jsonb not null default '{
    "day1": -35, "day2": -20, "day3": -10, "day4Plus": 0,
    "discovery7d": 5, "discovery14d": 10
  }',
  -- Products within this fraction of the top score for a slot are treated
  -- as equally qualified, so rotation can pick among them rather than
  -- always the single top score.
  rotation_band_pct numeric not null default 0.15,
  target_new_vs_yesterday integer not null default 8,
  max_daily_carryover integer not null default 4,
  cooldown_days jsonb not null default '{
    "proven": 1, "priority": 0, "inventory_push": 2, "test": 4, "seller_pick": 0
  }',
  updated_at timestamptz not null default now()
);
create unique index live_planner_config_singleton_idx on live_planner_config ((true));
insert into live_planner_config default values;

create table live_shifts (
  id uuid primary key default gen_random_uuid(),
  live_date date not null,
  shift live_shift_slot not null,
  status live_shift_status not null default 'draft',
  created_by uuid references staff_users(id),
  finalized_by uuid references staff_users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (live_date, shift)
);

create table live_basket_items (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references live_shifts(id) on delete cascade,
  product_id uuid not null references products(id),
  category live_basket_category not null,
  recommended_order integer not null,
  -- The exact factor breakdown + final score at generation time — powers
  -- the "why selected" explanation and lets later analysis compare the
  -- algorithm's choice against what a staff replacement actually did.
  score_snapshot jsonb,
  repeated_from_yesterday boolean not null default false,
  repeat_reason text,
  pin_start timestamptz,
  pin_end timestamptz,
  is_replacement boolean not null default false,
  replaced_item_id uuid references live_basket_items(id),
  replacement_reason live_replacement_reason,
  replaced_by uuid references staff_users(id),
  replaced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shift_id, recommended_order)
);
create index live_basket_items_product_idx on live_basket_items(product_id, created_at);
create index live_basket_items_shift_idx on live_basket_items(shift_id);

do $$ declare t text; begin
  foreach t in array array['product_live_flags', 'live_planner_config', 'live_shifts', 'live_basket_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;
