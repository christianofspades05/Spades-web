export interface Creator {
  id: string
  name: string
  email: string | null
  tiktok_url: string | null
  instagram_url: string | null
  facebook_url: string | null
  notes: string | null
  is_active: boolean
  /** Links to auth.users once an admin creates a portal login for this
   *  creator (see createCreatorPortalAccount) — null until then. */
  auth_user_id: string | null
  created_at: string
  updated_at: string
}
export interface CreatorAssignment {
  id: string
  creator_id: string
  discount_id: string
  commission_bps: number
  /** Affiliate sale mode (0135): extra % off on lines already on sale. */
  sale_discount_percent: number
  /** Commission on lines already on sale. */
  sale_commission_bps: number
  hold_days: number | null
  brand: string
  is_active: boolean
  created_at: string
}
export interface CreatorAttribution {
  order_id: string
  creator_id: string
  assignment_id: string
  code_snapshot: string
  commission_bps: number
  hold_days: number | null
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REVERSED'
  product_revenue_cents: number
  earned_cents: number
  paid_cents: number
  cogs_cents: number
  missing_cost: boolean
  hold_reasons: string[]
  eligible_at: string | null
  approved_at: string | null
  approved_by: string | null
  revision: number
  /** Blended rate the order actually earned at (0135); null when revenue 0. */
  effective_commission_bps: number | null
  /** Per-line rate audit trail (0135). */
  /** How the order was tied to the creator (0137): their code, or a
   *  ?ref= link visit with no code at checkout (0138). */
  attribution_type: 'code' | 'link'
  rate_breakdown: {
    order_item_id: string
    rate_bps: number
    revenue_cents: number
  }[]
  created_at: string
  updated_at: string
}
export interface CreatorExpense {
  id: string
  creator_id: string
  kind: 'content_fee' | 'gift' | 'other'
  description: string
  amount_cents: number
  variant_id: string | null
  quantity: number | null
  unit_cost_cents: number | null
  incurred_at: string
  paid_at: string | null
  staff_user_id: string
  created_at: string
}
export interface CreatorPayout {
  id: string
  creator_id: string
  reference: string
  amount_cents: number
  staff_user_id: string
  created_at: string
}
export interface CommissionEntry {
  id: string
  order_id: string
  revision: number
  amount_cents: number
  revenue_cents: number
  reason: string
  created_at: string
}
export interface OrderRefund {
  id: string
  order_id: string
  payment_id: string | null
  source: string
  external_id: string
  amount_cents: number
  shipping_cents: number
  tax_cents: number
  occurred_at: string
  allocation_complete: boolean
  created_at: string
}
type Table<T> = {
  Row: { [K in keyof T]: T[K] }
  Insert: { [K in keyof T]?: T[K] }
  Update: { [K in keyof T]?: T[K] }
  Relationships: []
}
export type CreatorTables = {
  creators: Table<Creator>
  creator_discount_assignments: Table<CreatorAssignment>
  order_creator_attributions: Table<CreatorAttribution>
  creator_commission_entries: Table<CommissionEntry>
  creator_expenses: Table<CreatorExpense>
  creator_payouts: Table<CreatorPayout>
  creator_payout_allocations: Table<{
    payout_id: string
    order_id: string
    amount_cents: number
  }>
  order_refunds: Table<OrderRefund>
  order_refund_items: Table<{
    id: string
    refund_id: string
    order_item_id: string
    return_id: string | null
    product_amount_cents: number
  }>
}
