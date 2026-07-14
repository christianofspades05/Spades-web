/**
 * Hand-written mirror of the Supabase schema (see supabase/migrations/0001_init_schema.sql).
 *
 * Once the project has a live Supabase instance, replace this file by running:
 *   npx supabase gen types typescript --project-id <project-ref> > src/types/database.types.ts
 * and re-export the generated `Database` type from here so the rest of the
 * app doesn't need to change its imports.
 */

export type ProductStatus = 'draft' | 'active' | 'archived'
export type ProductType =
  | 'tee'
  | 'polo'
  | 'hoodie'
  | 'jacket'
  | 'pants'
  | 'shorts'
  | 'accessory'
  | 'other'

export type CartStatus = 'active' | 'converted' | 'abandoned'

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'failed'

export type OrderSource = 'storefront' | 'admin' | 'tiktok_shop' | 'shopee'

export type PaymentProvider = 'cod' | 'gcash' | 'paymaya' | 'card' | 'bank_transfer' | 'other'
export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded'

export type ShipmentStatus =
  | 'pending'
  | 'packed'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned_to_sender'

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received' | 'refunded'

export type DiscountType = 'percentage' | 'fixed_amount' | 'free_shipping'
export type DiscountScope = 'all' | 'collection' | 'product' | 'variant'

export type StaffRole = 'super_admin' | 'admin' | 'manager' | 'packer' | 'support'

export type InventoryMovementType =
  | 'purchase_in'
  | 'sale_reserved'
  | 'sale_committed'
  | 'sale_released'
  | 'return_in'
  | 'adjustment'
  | 'marketplace_sync'

export type MarketplaceName = 'tiktok_shop' | 'shopee' | 'other'
export type MarketplaceConnectionStatus = 'active' | 'expired' | 'revoked'
export type MarketplaceSyncStatus = 'synced' | 'pending' | 'error'

export type WebhookSource = 'payment_provider' | 'tiktok_shop' | 'shopee' | 'shipmate' | 'other'
export type WebhookStatus = 'received' | 'processing' | 'processed' | 'failed'

export type ActivityActorType = 'staff' | 'customer' | 'system' | 'webhook'

export interface Database {
  public: {
    Tables: {
      customers: {
        Row: {
          id: string
          auth_user_id: string | null
          email: string
          phone: string | null
          full_name: string | null
          is_guest: boolean
          marketing_opt_in: boolean
          successful_orders_count: number
          cancelled_orders_count: number
          failed_delivery_count: number
          return_count: number
          is_high_risk: boolean
          cod_blocked: boolean
          risk_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['customers']['Row']> & {
          email: string
        }
        Update: Partial<Database['public']['Tables']['customers']['Row']>
      }
      customer_addresses: {
        Row: {
          id: string
          customer_id: string
          label: string | null
          recipient_name: string
          phone: string
          region: string
          province: string
          city: string
          barangay: string
          postal_code: string | null
          address_line1: string
          address_line2: string | null
          landmark: string | null
          is_default_shipping: boolean
          is_default_billing: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['customer_addresses']['Row']> & {
          customer_id: string
          recipient_name: string
          phone: string
          region: string
          province: string
          city: string
          barangay: string
          address_line1: string
        }
        Update: Partial<Database['public']['Tables']['customer_addresses']['Row']>
      }
      collections: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          image_url: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['collections']['Row']> & {
          slug: string
          name: string
        }
        Update: Partial<Database['public']['Tables']['collections']['Row']>
      }
      products: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          product_type: ProductType
          status: ProductStatus
          images: string[]
          seo_title: string | null
          seo_description: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['products']['Row']> & {
          slug: string
          name: string
        }
        Update: Partial<Database['public']['Tables']['products']['Row']>
      }
      product_variants: {
        Row: {
          id: string
          product_id: string
          sku: string
          size: string | null
          color: string | null
          style: string | null
          price_cents: number
          compare_at_price_cents: number | null
          weight_grams: number | null
          barcode: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['product_variants']['Row']> & {
          product_id: string
          sku: string
          price_cents: number
        }
        Update: Partial<Database['public']['Tables']['product_variants']['Row']>
      }
      product_collections: {
        Row: {
          product_id: string
          collection_id: string
          sort_order: number
        }
        Insert: Database['public']['Tables']['product_collections']['Row']
        Update: Partial<Database['public']['Tables']['product_collections']['Row']>
      }
      inventory: {
        Row: {
          id: string
          variant_id: string
          location_code: string
          quantity_on_hand: number
          quantity_reserved: number
          quantity_available: number
          low_stock_threshold: number
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['inventory']['Row']> & {
          variant_id: string
        }
        Update: Partial<Database['public']['Tables']['inventory']['Row']>
      }
      inventory_movements: {
        Row: {
          id: string
          variant_id: string
          location_code: string
          movement_type: InventoryMovementType
          quantity_delta: number
          reference_type: string | null
          reference_id: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['inventory_movements']['Row']> & {
          variant_id: string
          movement_type: InventoryMovementType
          quantity_delta: number
        }
        Update: Partial<Database['public']['Tables']['inventory_movements']['Row']>
      }
      carts: {
        Row: {
          id: string
          customer_id: string | null
          session_token: string | null
          status: CartStatus
          currency: string
          created_at: string
          updated_at: string
          expires_at: string | null
        }
        Insert: Partial<Database['public']['Tables']['carts']['Row']>
        Update: Partial<Database['public']['Tables']['carts']['Row']>
      }
      cart_items: {
        Row: {
          id: string
          cart_id: string
          variant_id: string
          quantity: number
          price_cents_snapshot: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['cart_items']['Row']> & {
          cart_id: string
          variant_id: string
          quantity: number
          price_cents_snapshot: number
        }
        Update: Partial<Database['public']['Tables']['cart_items']['Row']>
      }
      orders: {
        Row: {
          id: string
          order_number: string
          customer_id: string
          status: OrderStatus
          source: OrderSource
          external_order_id: string | null
          subtotal_cents: number
          discount_cents: number
          shipping_cents: number
          tax_cents: number
          total_cents: number
          currency: string
          discount_id: string | null
          shipping_address: Record<string, unknown>
          billing_address: Record<string, unknown> | null
          is_cod: boolean
          cod_eligibility_reason: string | null
          requires_partial_payment: boolean
          risk_score: number | null
          placed_at: string
          cancelled_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['orders']['Row']> & {
          order_number: string
          customer_id: string
          shipping_address: Record<string, unknown>
        }
        Update: Partial<Database['public']['Tables']['orders']['Row']>
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          variant_id: string | null
          product_name_snapshot: string
          variant_label_snapshot: string | null
          sku_snapshot: string
          unit_price_cents: number
          quantity: number
          line_subtotal_cents: number
          line_discount_cents: number
          line_total_cents: number
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['order_items']['Row']> & {
          order_id: string
          product_name_snapshot: string
          sku_snapshot: string
          unit_price_cents: number
          quantity: number
          line_subtotal_cents: number
          line_total_cents: number
        }
        Update: Partial<Database['public']['Tables']['order_items']['Row']>
      }
      payments: {
        Row: {
          id: string
          order_id: string
          provider: PaymentProvider
          provider_reference: string | null
          idempotency_key: string
          status: PaymentStatus
          amount_cents: number
          is_partial: boolean
          raw_payload: Record<string, unknown> | null
          captured_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['payments']['Row']> & {
          order_id: string
          provider: PaymentProvider
          idempotency_key: string
          amount_cents: number
        }
        Update: Partial<Database['public']['Tables']['payments']['Row']>
      }
      shipments: {
        Row: {
          id: string
          order_id: string
          carrier: string | null
          tracking_number: string | null
          status: ShipmentStatus
          packed_by: string | null
          label_url: string | null
          raw_payload: Record<string, unknown> | null
          shipped_at: string | null
          delivered_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['shipments']['Row']> & {
          order_id: string
        }
        Update: Partial<Database['public']['Tables']['shipments']['Row']>
      }
      returns: {
        Row: {
          id: string
          order_id: string
          order_item_id: string | null
          customer_id: string
          reason: string
          status: ReturnStatus
          quantity: number
          refund_amount_cents: number | null
          resolution_notes: string | null
          requested_at: string
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['returns']['Row']> & {
          order_id: string
          customer_id: string
          reason: string
        }
        Update: Partial<Database['public']['Tables']['returns']['Row']>
      }
      discounts: {
        Row: {
          id: string
          code: string
          type: DiscountType
          value: number
          scope: DiscountScope
          scope_ids: string[]
          min_subtotal_cents: number
          max_uses: number | null
          max_uses_per_customer: number | null
          times_used: number
          starts_at: string | null
          ends_at: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['discounts']['Row']> & {
          code: string
          type: DiscountType
          value: number
        }
        Update: Partial<Database['public']['Tables']['discounts']['Row']>
      }
      staff_users: {
        Row: {
          id: string
          auth_user_id: string
          full_name: string
          role: StaffRole
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['staff_users']['Row']> & {
          auth_user_id: string
          full_name: string
        }
        Update: Partial<Database['public']['Tables']['staff_users']['Row']>
      }
      activity_logs: {
        Row: {
          id: string
          actor_type: ActivityActorType
          staff_user_id: string | null
          customer_id: string | null
          action: string
          entity_type: string | null
          entity_id: string | null
          metadata: Record<string, unknown>
          ip_address: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['activity_logs']['Row']> & {
          actor_type: ActivityActorType
          action: string
        }
        Update: Partial<Database['public']['Tables']['activity_logs']['Row']>
      }
      marketplace_connections: {
        Row: {
          id: string
          marketplace: MarketplaceName
          shop_name: string | null
          external_shop_id: string | null
          access_token_encrypted: string | null
          refresh_token_encrypted: string | null
          token_expires_at: string | null
          status: MarketplaceConnectionStatus
          connected_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['marketplace_connections']['Row']> & {
          marketplace: MarketplaceName
        }
        Update: Partial<Database['public']['Tables']['marketplace_connections']['Row']>
      }
      marketplace_product_mappings: {
        Row: {
          id: string
          marketplace_connection_id: string
          variant_id: string
          external_product_id: string | null
          external_sku: string | null
          external_variant_id: string
          sync_status: MarketplaceSyncStatus
          last_synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['marketplace_product_mappings']['Row']> & {
          marketplace_connection_id: string
          variant_id: string
          external_variant_id: string
        }
        Update: Partial<Database['public']['Tables']['marketplace_product_mappings']['Row']>
      }
      webhook_events: {
        Row: {
          id: string
          source: WebhookSource
          event_type: string
          external_event_id: string
          payload: Record<string, unknown>
          status: WebhookStatus
          received_at: string
          processed_at: string | null
          error_message: string | null
        }
        Insert: Partial<Database['public']['Tables']['webhook_events']['Row']> & {
          source: WebhookSource
          event_type: string
          external_event_id: string
          payload: Record<string, unknown>
        }
        Update: Partial<Database['public']['Tables']['webhook_events']['Row']>
      }
    }
  }
}
