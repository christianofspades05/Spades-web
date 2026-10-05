-- Removes the manual "Seller's Pick" slot from the LIVE Product Planner —
-- staff found the extra manual-choice step unwanted; every slot is now
-- auto-generated. Not dropping the 'seller_pick' value from the
-- live_basket_category enum itself (Postgres can't drop an enum value
-- without recreating the type) — confirmed live, zero rows have ever used
-- it, so this is purely a config change, nothing to migrate off of.
update live_planner_config set
  basket_size = 13,
  slot_counts = '{
    "proven": 4, "priority": 3, "inventory_push": 2, "test": 2, "restock": 2
  }',
  cooldown_days = '{
    "proven": 1, "priority": 0, "inventory_push": 2, "test": 4, "restock": 1
  }',
  updated_at = now();
