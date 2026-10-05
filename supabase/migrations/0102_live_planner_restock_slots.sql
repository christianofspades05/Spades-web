-- The singleton config row (still at its original defaults — confirmed
-- live, never edited via updateLivePlannerConfig) gets two new 'restock'
-- slots added on top of the existing categories (basket_size 12 -> 14)
-- rather than taking slots away from an existing category, since this is
-- adding a new kind of exposure, not replacing one. Every existing
-- category's weight set also gets a restockRecency key (0 — restock
-- freshness isn't a factor for them) so every category shares the same
-- ScoreFactors shape the scoring engine now expects.
update live_planner_config set
  basket_size = 14,
  slot_counts = '{
    "proven": 4, "priority": 3, "inventory_push": 2, "test": 2, "restock": 2, "seller_pick": 1
  }',
  scoring_weights = '{
    "proven": {"velocity": 35, "inventoryHealth": 20, "sizeAvailability": 20, "momentum": 10, "daysOfStock": 10, "strategicPriority": 5, "restockRecency": 0},
    "priority": {"velocity": 10, "inventoryHealth": 15, "sizeAvailability": 15, "momentum": 10, "daysOfStock": 5, "strategicPriority": 45, "restockRecency": 0},
    "inventory_push": {"velocity": 15, "inventoryHealth": 15, "sizeAvailability": 20, "momentum": 5, "daysOfStock": 40, "strategicPriority": 5, "restockRecency": 0},
    "test": {"velocity": 15, "inventoryHealth": 15, "sizeAvailability": 20, "momentum": 20, "daysOfStock": 5, "strategicPriority": 25, "restockRecency": 0},
    "restock": {"velocity": 10, "inventoryHealth": 15, "sizeAvailability": 20, "momentum": 0, "daysOfStock": 0, "strategicPriority": 5, "restockRecency": 50}
  }',
  cooldown_days = '{
    "proven": 1, "priority": 0, "inventory_push": 2, "test": 4, "restock": 1, "seller_pick": 0
  }',
  updated_at = now();
