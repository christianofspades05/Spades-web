/**
 * Hand-written mirror of the Supabase schema (see supabase/migrations/0001_init_schema.sql).
 *
 * Once the project has a live Supabase instance, replace this file by running:
 *   npx supabase gen types typescript --project-id <project-ref> > src/types/database.types.ts
 * and re-export the generated `Database` type from here so the rest of the
 * app doesn't need to change its imports.
 */

export type ProductStatus = 'draft' | 'active' | 'archived'
export type ProductBrand = 'spades' | 'ysrael' | 'aspire365'
export type CollectionMatchType = 'all' | 'any'
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
export type CustomerAuthProvider = 'email' | 'google'

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

export type OrderCancellationReason =
  | 'failed_delivery'
  | 'customer_request'
  | 'out_of_stock'
  | 'platform_cancelled'
  | 'payment_expired'

export type OrderSource =
  'storefront' | 'admin' | 'tiktok_shop' | 'shopee' | 'lazada'

/** order_items-shaped snapshot held on a checkout_reservations row until
 *  the Xendit webhook mints real order_items rows from it. */
export interface CheckoutReservationItem {
  variantId: string | null
  productNameSnapshot: string
  variantLabelSnapshot: string | null
  skuSnapshot: string
  unitPriceCents: number
  quantity: number
  lineSubtotalCents: number
  lineDiscountCents: number
  lineTotalCents: number
}

export type ShippingMethod = 'standard' | 'lalamove'

/** Lalamove quotation + dropoff pin captured at checkout time, held on
 *  checkout_reservations/orders until staff books the actual trip (see
 *  bookLalamoveShipment in server/admin/orders.ts) — the checkout-time
 *  quotationId is expired (5-minute validity) by the time that happens, so
 *  it's kept only for audit purposes; booking always fetches a fresh one. */
export interface LalamoveInfo {
  quotationId: string
  pickupStopId: string
  dropoffStopId: string
  dropoffLat: number
  dropoffLng: number
  dropoffAddress: string
  estimatedFeeCents: number
  quotedAt: string
}

export type SyncLogStatus = 'success' | 'failed'

export type PaymentProvider =
  'cod' | 'gcash' | 'paymaya' | 'card' | 'bank_transfer' | 'other'
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'

export type ShipmentStatus =
  | 'pending'
  | 'packed'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned_to_sender'

export type ReturnStatus =
  'requested' | 'approved' | 'rejected' | 'received' | 'refunded'

export type DiscountType = 'percentage' | 'fixed_amount' | 'free_shipping'
export type DiscountKind = 'code' | 'automatic'
export type DiscountScope = 'all' | 'collection' | 'product' | 'variant'
export type CodRestrictionScope = 'collection' | 'product'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type EmailAutomationEventType =
  'welcome' | 'abandoned_cart' | 'post_purchase_review' | 'birthday'

export type EmailBlockType =
  | 'header_image'
  | 'heading'
  | 'text'
  | 'button'
  | 'discount_code'
  | 'cart_items'
  | 'order_items'
  | 'footer'

/** One content block in an email_automations.blocks array. Loosely typed
 *  (every field optional) rather than a strict discriminated union, same
 *  reasoning as storefront_sections: which fields apply depends on `type`,
 *  and that's enforced at the app layer (see
 *  lib/validation/admin/email-automations.ts), not in this type. The
 *  discount_code/footer block types carry no extra fields — the discount's
 *  actual code/value is resolved from the automation's discount_id at send
 *  time, and the footer is always a fixed unsubscribe line.
 *  cart_items/order_items carry no fields either — a positionable
 *  placeholder for that event's per-recipient item list, which varies per
 *  send and is never stored on the automation itself (see
 *  lib/email/blocks.ts's renderEmailBlocks). */
export interface EmailBlock {
  type: EmailBlockType
  /** header_image */
  imageUrl?: string
  /** heading, text */
  text?: string
  /** button */
  buttonLabel?: string
  buttonUrl?: string
}

export type StaffRole =
  'super_admin' | 'admin' | 'manager' | 'packer' | 'support'

export type InventoryMovementType =
  | 'purchase_in'
  | 'sale_reserved'
  | 'sale_committed'
  | 'sale_released'
  | 'return_in'
  | 'adjustment'
  | 'marketplace_sync'

export type MarketplaceName = 'tiktok_shop' | 'shopee' | 'lazada' | 'other'

export type StorefrontSectionType =
  'hero' | 'tagline' | 'image' | 'video' | 'product_grid'

export type StorefrontPage = 'home' | 'about'
export type MarketplaceConnectionStatus =
  'active' | 'expired' | 'revoked' | 'error'
export type MarketplaceSyncStatus = 'synced' | 'pending' | 'error'

export type WebhookSource =
  'payment_provider' | 'tiktok_shop' | 'shopee' | 'shipmate' | 'other'
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
          auth_provider: CustomerAuthProvider | null
          google_id: string | null
          phone_number: string | null
          email_verified: boolean
          phone_verified: boolean
          last_login_at: string | null
          imported_total_spent_cents: number | null
          imported_source: string | null
          date_of_birth: string | null
          welcome_emailed_at: string | null
          birthday_last_emailed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['customers']['Row']> & {
          email: string
        }
        Update: Partial<Database['public']['Tables']['customers']['Row']>
        Relationships: []
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
        Insert: Partial<
          Database['public']['Tables']['customer_addresses']['Row']
        > & {
          customer_id: string
          recipient_name: string
          phone: string
          region: string
          province: string
          city: string
          barangay: string
          address_line1: string
        }
        Update: Partial<
          Database['public']['Tables']['customer_addresses']['Row']
        >
        Relationships: []
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
          hide_out_of_stock_products: boolean
          match_type: CollectionMatchType
          rules: unknown
          sort_by: string
          max_products: number | null
          brand: ProductBrand
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['collections']['Row']> & {
          slug: string
          name: string
        }
        Update: Partial<Database['public']['Tables']['collections']['Row']>
        Relationships: []
      }
      storefront_sections: {
        Row: {
          id: string
          type: StorefrontSectionType
          page: StorefrontPage
          brand: string
          sort_order: number
          is_active: boolean
          title: string | null
          title_ja: string | null
          title_ko: string | null
          subtitle: string | null
          subtitle_ja: string | null
          subtitle_ko: string | null
          media_url: string | null
          link_url: string | null
          collection_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['storefront_sections']['Row']
        > & {
          type: StorefrontSectionType
        }
        Update: Partial<
          Database['public']['Tables']['storefront_sections']['Row']
        >
        Relationships: []
      }
      storefront_maintenance_mode: {
        Row: {
          brand: ProductBrand
          is_active: boolean
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['storefront_maintenance_mode']['Row']
        > & {
          brand: ProductBrand
        }
        Update: Partial<
          Database['public']['Tables']['storefront_maintenance_mode']['Row']
        >
        Relationships: []
      }
      storefront_banner: {
        Row: {
          id: string
          brand: ProductBrand
          text: string
          text_ja: string | null
          text_ko: string | null
          is_active: boolean
          sort_order: number
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['storefront_banner']['Row']
        > & {
          brand: ProductBrand
        }
        Update: Partial<
          Database['public']['Tables']['storefront_banner']['Row']
        >
        Relationships: []
      }
      products: {
        Row: {
          id: string
          slug: string
          name: string
          name_search: string
          description: string | null
          description_ja: string | null
          description_ko: string | null
          product_type: ProductType
          status: ProductStatus
          brand: ProductBrand
          images: string[]
          tags: string[]
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
        Relationships: []
      }
      product_variants: {
        Row: {
          id: string
          product_id: string
          sku: string | null
          size: string | null
          color: string | null
          style: string | null
          price_cents: number
          compare_at_price_cents: number | null
          cost_cents: number | null
          weight_grams: number | null
          barcode: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['product_variants']['Row']
        > & {
          product_id: string
          price_cents: number
        }
        Update: Partial<Database['public']['Tables']['product_variants']['Row']>
        Relationships: [
          {
            foreignKeyName: 'product_variants_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      product_collections: {
        Row: {
          product_id: string
          collection_id: string
          sort_order: number
        }
        Insert: Database['public']['Tables']['product_collections']['Row']
        Update: Partial<
          Database['public']['Tables']['product_collections']['Row']
        >
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: 'inventory_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      variant_stock_recounts: {
        Row: {
          variant_id: string
          recounted_quantity_available: number
          recounted_at: string
          staff_user_id: string | null
        }
        Insert: Partial<
          Database['public']['Tables']['variant_stock_recounts']['Row']
        > & {
          variant_id: string
          recounted_quantity_available: number
        }
        Update: Partial<
          Database['public']['Tables']['variant_stock_recounts']['Row']
        >
        Relationships: [
          {
            foreignKeyName: 'variant_stock_recounts_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: true
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'variant_stock_recounts_staff_user_id_fkey'
            columns: ['staff_user_id']
            isOneToOne: false
            referencedRelation: 'staff_users'
            referencedColumns: ['id']
          },
        ]
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
        Insert: Partial<
          Database['public']['Tables']['inventory_movements']['Row']
        > & {
          variant_id: string
          movement_type: InventoryMovementType
          quantity_delta: number
        }
        Update: Partial<
          Database['public']['Tables']['inventory_movements']['Row']
        >
        Relationships: []
      }
      carts: {
        Row: {
          id: string
          customer_id: string | null
          session_token: string | null
          status: CartStatus
          currency: string
          discount_id: string | null
          email: string | null
          recovery_token: string | null
          unsubscribe_token: string | null
          abandoned_cart_discount_id: string | null
          created_at: string
          updated_at: string
          expires_at: string | null
        }
        Insert: Partial<Database['public']['Tables']['carts']['Row']>
        Update: Partial<Database['public']['Tables']['carts']['Row']>
        Relationships: []
      }
      cart_abandonment_sends: {
        Row: {
          id: string
          cart_id: string
          email_automation_id: string
          sent_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['cart_abandonment_sends']['Row']
        > & { cart_id: string; email_automation_id: string }
        Update: Partial<
          Database['public']['Tables']['cart_abandonment_sends']['Row']
        >
        Relationships: []
      }
      email_unsubscribes: {
        Row: {
          email: string
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['email_unsubscribes']['Row']
        > & { email: string }
        Update: Partial<
          Database['public']['Tables']['email_unsubscribes']['Row']
        >
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: 'cart_items_variant_id_fkey'
            columns: ['variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['id']
          },
        ]
      }
      orders: {
        Row: {
          id: string
          order_number: string
          customer_id: string
          status: OrderStatus
          source: OrderSource
          external_order_id: string | null
          platform_order_data: Record<string, unknown> | null
          subtotal_cents: number
          discount_cents: number
          shipping_cents: number
          tax_cents: number
          total_cents: number
          platform_fees_cents: number
          platform_fee_breakdown: { label: string; amountCents: number }[]
          platform_discount_cents: number
          currency: string
          brand: string
          market_markup_percent: number | null
          discount_id: string | null
          shipping_address: Record<string, unknown>
          billing_address: Record<string, unknown> | null
          is_cod: boolean
          has_shipment: boolean
          shipping_method: ShippingMethod
          lalamove_info: LalamoveInfo | null
          cod_eligibility_reason: string | null
          requires_partial_payment: boolean
          risk_score: number | null
          placed_at: string
          cancelled_at: string | null
          cancellation_reason: OrderCancellationReason | null
          cancellation_detail: string | null
          notes: string | null
          customer_notes: string | null
          review_requested_at: string | null
          review_request_sent: boolean
          review_token: string | null
          review_token_expires_at: string | null
          review_token_used_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['orders']['Row']> & {
          customer_id: string
          shipping_address: Record<string, unknown>
        }
        Update: Partial<Database['public']['Tables']['orders']['Row']>
        Relationships: [
          {
            foreignKeyName: 'orders_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
        ]
      }
      checkout_reservations: {
        Row: {
          id: string
          customer_id: string
          cart_id: string
          brand: string
          currency: string
          subtotal_cents: number
          discount_cents: number
          shipping_cents: number
          total_cents: number
          discount_id: string | null
          market_markup_percent: number | null
          shipping_address: Record<string, unknown>
          items: CheckoutReservationItem[]
          shipping_method: ShippingMethod
          lalamove_info: LalamoveInfo | null
          customer_notes: string | null
          xendit_invoice_id: string | null
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['checkout_reservations']['Row']
        > & {
          customer_id: string
          cart_id: string
          brand: string
          currency: string
          subtotal_cents: number
          discount_cents: number
          shipping_cents: number
          total_cents: number
          shipping_address: Record<string, unknown>
          items: CheckoutReservationItem[]
        }
        Update: Partial<
          Database['public']['Tables']['checkout_reservations']['Row']
        >
        Relationships: []
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
          charged_currency: string | null
          charged_amount_cents: number | null
          fx_rate_to_php: number | null
        }
        Insert: Partial<Database['public']['Tables']['payments']['Row']> & {
          order_id: string
          provider: PaymentProvider
          idempotency_key: string
          amount_cents: number
        }
        Update: Partial<Database['public']['Tables']['payments']['Row']>
        Relationships: []
      }
      shipments: {
        Row: {
          id: string
          order_id: string
          carrier: string | null
          tracking_number: string | null
          tracking_url: string | null
          status: ShipmentStatus
          packed_by: string | null
          label_url: string | null
          pickup_photo_url: string | null
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
        Relationships: []
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
          external_return_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['returns']['Row']> & {
          order_id: string
          customer_id: string
          reason: string
        }
        Update: Partial<Database['public']['Tables']['returns']['Row']>
        Relationships: []
      }
      discounts: {
        Row: {
          id: string
          code: string | null
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
          kind: DiscountKind
          title: string
          excluded_collection_ids: string[]
          email_automation_id: string | null
          max_discounted_items: number | null
          excludes_free_shipping: boolean
          stacks_with_sale: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['discounts']['Row']> & {
          type: DiscountType
          value: number
          title: string
        }
        Update: Partial<Database['public']['Tables']['discounts']['Row']>
        Relationships: []
      }
      email_automations: {
        Row: {
          id: string
          event_type: EmailAutomationEventType
          name: string
          is_active: boolean
          subject: string
          blocks: EmailBlock[]
          discount_id: string | null
          delay_hours: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['email_automations']['Row']
        > & {
          event_type: EmailAutomationEventType
          name: string
        }
        Update: Partial<
          Database['public']['Tables']['email_automations']['Row']
        >
        Relationships: []
      }
      email_sends: {
        Row: {
          id: string
          email_automation_id: string
          recipient_email: string
          discount_id: string | null
          sent_at: string
        }
        Insert: Partial<Database['public']['Tables']['email_sends']['Row']> & {
          email_automation_id: string
          recipient_email: string
        }
        Update: Partial<Database['public']['Tables']['email_sends']['Row']>
        Relationships: []
      }
      exchange_rates: {
        Row: {
          currency: string
          rate_to_php: number
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['exchange_rates']['Row']
        > & {
          currency: string
          rate_to_php: number
        }
        Update: Partial<Database['public']['Tables']['exchange_rates']['Row']>
        Relationships: []
      }
      cod_restrictions: {
        Row: {
          id: string
          title: string
          scope: CodRestrictionScope
          scope_ids: string[]
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['cod_restrictions']['Row']
        > & {
          title: string
          scope: CodRestrictionScope
        }
        Update: Partial<Database['public']['Tables']['cod_restrictions']['Row']>
        Relationships: []
      }
      markets: {
        Row: {
          id: string
          markup_percent: number
          is_active: boolean
          shipping_name: string | null
          shipping_price_cents: number | null
          shipping_currency: string
          free_shipping_min_subtotal_cents: number | null
          free_shipping_min_items: number | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['markets']['Row']> & {
          markup_percent: number
        }
        Update: Partial<Database['public']['Tables']['markets']['Row']>
        Relationships: []
      }
      market_countries: {
        Row: {
          market_id: string
          country_code: string
        }
        Insert: Database['public']['Tables']['market_countries']['Row']
        Update: Partial<Database['public']['Tables']['market_countries']['Row']>
        Relationships: [
          {
            foreignKeyName: 'market_countries_market_id_fkey'
            columns: ['market_id']
            isOneToOne: false
            referencedRelation: 'markets'
            referencedColumns: ['id']
          },
        ]
      }
      reviews: {
        Row: {
          id: string
          product_id: string
          order_id: string | null
          customer_email: string
          customer_name: string | null
          rating: number
          review_text: string | null
          photo_urls: string[]
          status: ReviewStatus
          imported_source: string | null
          imported_review_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['reviews']['Row']> & {
          product_id: string
          customer_email: string
          rating: number
        }
        Update: Partial<Database['public']['Tables']['reviews']['Row']>
        Relationships: [
          {
            foreignKeyName: 'reviews_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reviews_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
        ]
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
        Relationships: []
      }
      order_email_messages: {
        Row: {
          id: string
          order_id: string
          direction: 'outbound' | 'inbound'
          subject: string
          body_html: string | null
          body_text: string | null
          from_address: string
          to_address: string
          resend_email_id: string | null
          staff_user_id: string | null
          read_at: string | null
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['order_email_messages']['Row']
        > & {
          order_id: string
          direction: 'outbound' | 'inbound'
          subject: string
          from_address: string
          to_address: string
        }
        Update: Partial<
          Database['public']['Tables']['order_email_messages']['Row']
        >
        Relationships: [
          {
            foreignKeyName: 'order_email_messages_order_id_fkey'
            columns: ['order_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'order_email_messages_staff_user_id_fkey'
            columns: ['staff_user_id']
            isOneToOne: false
            referencedRelation: 'staff_users'
            referencedColumns: ['id']
          },
        ]
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
        Insert: Partial<
          Database['public']['Tables']['activity_logs']['Row']
        > & {
          actor_type: ActivityActorType
          action: string
        }
        Update: Partial<Database['public']['Tables']['activity_logs']['Row']>
        Relationships: []
      }
      marketplace_connections: {
        Row: {
          id: string
          marketplace: MarketplaceName
          shop_name: string | null
          external_shop_id: string | null
          shop_cipher: string | null
          access_token_encrypted: string | null
          refresh_token_encrypted: string | null
          token_expires_at: string | null
          status: MarketplaceConnectionStatus
          inventory_sync_enabled: boolean
          price_sync_enabled: boolean
          price_markup_percent: number
          connected_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['marketplace_connections']['Row']
        > & {
          marketplace: MarketplaceName
        }
        Update: Partial<
          Database['public']['Tables']['marketplace_connections']['Row']
        >
        Relationships: []
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
          last_pushed_quantity: number | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['marketplace_product_mappings']['Row']
        > & {
          marketplace_connection_id: string
          variant_id: string
          external_variant_id: string
        }
        Update: Partial<
          Database['public']['Tables']['marketplace_product_mappings']['Row']
        >
        Relationships: []
      }
      marketplace_category_defaults: {
        Row: {
          id: string
          marketplace: string
          product_type: ProductType
          category_id: string
          category_name: string
          attribute_defaults: unknown
          created_at: string
          updated_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['marketplace_category_defaults']['Row']
        > & {
          marketplace: string
          product_type: ProductType
          category_id: string
          category_name: string
        }
        Update: Partial<
          Database['public']['Tables']['marketplace_category_defaults']['Row']
        >
        Relationships: []
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
        Insert: Partial<
          Database['public']['Tables']['webhook_events']['Row']
        > & {
          source: WebhookSource
          event_type: string
          external_event_id: string
          payload: Record<string, unknown>
        }
        Update: Partial<Database['public']['Tables']['webhook_events']['Row']>
        Relationships: []
      }
      storefront_presence: {
        Row: {
          visitor_id: string
          brand: string
          path: string | null
          last_seen_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['storefront_presence']['Row']
        > & {
          visitor_id: string
        }
        Update: Partial<
          Database['public']['Tables']['storefront_presence']['Row']
        >
        Relationships: []
      }
      storefront_visits: {
        Row: {
          id: string
          visitor_id: string
          path: string
          event_type: string
          product_id: string | null
          metadata: Record<string, unknown>
          brand: string
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['storefront_visits']['Row']
        > & {
          visitor_id: string
          path: string
        }
        Update: Partial<
          Database['public']['Tables']['storefront_visits']['Row']
        >
        Relationships: []
      }
      store_feedback: {
        Row: {
          id: string
          name: string | null
          email: string
          phone: string | null
          comment: string | null
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['store_feedback']['Row']
        > & {
          email: string
        }
        Update: Partial<Database['public']['Tables']['store_feedback']['Row']>
        Relationships: []
      }
      sync_logs: {
        Row: {
          id: string
          marketplace: MarketplaceName
          operation: string
          status: SyncLogStatus
          detail: Record<string, unknown>
          error_message: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['sync_logs']['Row']> & {
          marketplace: MarketplaceName
          operation: string
          status: SyncLogStatus
        }
        Update: Partial<Database['public']['Tables']['sync_logs']['Row']>
        Relationships: []
      }
    }
    Views: {
      storefront_product_listing: {
        Row: {
          id: string
          slug: string
          name: string
          name_search: string
          description: string | null
          product_type: ProductType
          images: string[]
          tags: string[]
          created_at: string
          updated_at: string
          min_price_cents: number
          total_stock: number
          brand: ProductBrand
        }
        Relationships: []
      }
    }
    Functions: {
      reserve_variant_stock: {
        Args: {
          p_variant_id: string
          p_quantity: number
          p_location_code?: string
          p_reference_type?: string | null
          p_reference_id?: string | null
        }
        Returns: boolean
      }
      release_variant_stock: {
        Args: {
          p_variant_id: string
          p_quantity: number
          p_location_code?: string
          p_reference_type?: string | null
          p_reference_id?: string | null
        }
        Returns: undefined
      }
      commit_variant_stock: {
        Args: {
          p_variant_id: string
          p_quantity: number
          p_location_code?: string
          p_reference_type?: string | null
          p_reference_id?: string | null
        }
        Returns: undefined
      }
      restock_variant_stock: {
        Args: {
          p_variant_id: string
          p_quantity: number
          p_location_code?: string
          p_reference_type?: string | null
          p_reference_id?: string | null
        }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
