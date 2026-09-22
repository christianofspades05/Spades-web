export type LiveShiftSlot = '10am_2pm' | '6pm_10pm' | '10pm_2am'
export type LiveBasketCategory =
  | 'proven'
  | 'priority'
  | 'inventory_push'
  | 'test'
  | 'seller_pick'
export type LiveShiftStatus = 'draft' | 'finalized' | 'live' | 'completed'
export type LiveReplacementReason =
  | 'viewer_request'
  | 'low_engagement'
  | 'product_sold_out'
  | 'size_sold_out'
  | 'seller_judgment'
  | 'management_request'
  | 'other'

export interface ProductLiveFlagsRow {
  product_id: string
  live_eligible: boolean
  manual_live_lock: boolean
  manual_priority: boolean
  anchor_product: boolean
  updated_at: string
}

export interface LivePlannerConfigRow {
  id: string
  basket_size: number
  slot_counts: Record<LiveBasketCategory, number>
  scoring_weights: Record<
    Exclude<LiveBasketCategory, 'seller_pick'>,
    {
      velocity: number
      inventoryHealth: number
      sizeAvailability: number
      momentum: number
      daysOfStock: number
      strategicPriority: number
    }
  >
  new_product_protection_days: number
  max_test_appearances: number
  min_inventory: number
  min_size_health_score: number
  max_consecutive_appearances: number
  rotation_penalty: {
    day1: number
    day2: number
    day3: number
    day4Plus: number
    discovery7d: number
    discovery14d: number
  }
  rotation_band_pct: number
  target_new_vs_yesterday: number
  max_daily_carryover: number
  cooldown_days: Record<LiveBasketCategory, number>
  updated_at: string
}

export interface LiveShiftRow {
  id: string
  live_date: string
  shift: LiveShiftSlot
  status: LiveShiftStatus
  created_by: string | null
  finalized_by: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface LiveBasketItemRow {
  id: string
  shift_id: string
  product_id: string
  category: LiveBasketCategory
  recommended_order: number
  /** Concrete shape lives in #/lib/live-planner/scoring's ScoreSnapshot —
   *  kept as unknown here since this file has no dependency on that
   *  module and jsonb is genuinely untyped at the DB layer. */
  score_snapshot: unknown
  repeated_from_yesterday: boolean
  repeat_reason: string | null
  pin_start: string | null
  pin_end: string | null
  is_replacement: boolean
  original_product_id: string | null
  replacement_reason: LiveReplacementReason | null
  replaced_by: string | null
  replaced_at: string | null
  created_at: string
}

type Table<T> = {
  Row: { [K in keyof T]: T[K] }
  Insert: { [K in keyof T]?: T[K] }
  Update: { [K in keyof T]?: T[K] }
  Relationships: []
}

export type LivePlannerTables = {
  product_live_flags: Table<ProductLiveFlagsRow>
  live_planner_config: Table<LivePlannerConfigRow>
  live_shifts: Table<LiveShiftRow>
  live_basket_items: Table<LiveBasketItemRow>
}
