/**
 * Domain-friendly types for the core ecommerce entities, layered on top of
 * the raw DB row shapes in `database.types.ts`. Prefer importing from here
 * in application code; import `database.types.ts` directly only inside
 * lib/supabase and server/ code that talks to Supabase.
 */
import type { Database } from './database.types'

export type {
  ActivityActorType,
  CartStatus,
  DiscountScope,
  DiscountType,
  InventoryMovementType,
  MarketplaceConnectionStatus,
  MarketplaceName,
  MarketplaceSyncStatus,
  OrderSource,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  ProductType,
  ReturnStatus,
  ShipmentStatus,
  StaffRole,
  WebhookSource,
  WebhookStatus,
} from './database.types'

export type Customer = Database['public']['Tables']['customers']['Row']
export type CustomerAddress = Database['public']['Tables']['customer_addresses']['Row']
export type Collection = Database['public']['Tables']['collections']['Row']
export type Product = Database['public']['Tables']['products']['Row']
export type ProductVariant = Database['public']['Tables']['product_variants']['Row']
export type Inventory = Database['public']['Tables']['inventory']['Row']
export type Cart = Database['public']['Tables']['carts']['Row']
export type CartItem = Database['public']['Tables']['cart_items']['Row']
export type Order = Database['public']['Tables']['orders']['Row']
export type OrderItem = Database['public']['Tables']['order_items']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type Shipment = Database['public']['Tables']['shipments']['Row']
export type Return = Database['public']['Tables']['returns']['Row']
export type Discount = Database['public']['Tables']['discounts']['Row']
export type StaffUser = Database['public']['Tables']['staff_users']['Row']
export type ActivityLog = Database['public']['Tables']['activity_logs']['Row']
export type MarketplaceConnection = Database['public']['Tables']['marketplace_connections']['Row']
export type MarketplaceProductMapping = Database['public']['Tables']['marketplace_product_mappings']['Row']
export type WebhookEvent = Database['public']['Tables']['webhook_events']['Row']

/** A product with its variants attached — the shape most storefront pages need. */
export interface ProductWithVariants extends Product {
  variants: ProductVariant[]
}

/** A variant with enough product context to render in a cart/order line. */
export interface VariantWithProduct extends ProductVariant {
  product: Pick<Product, 'id' | 'slug' | 'name' | 'images'>
}

/** A cart item joined with its variant/product for rendering. */
export interface CartItemWithVariant extends CartItem {
  variant: VariantWithProduct
}

/** Money is always handled in integer cents server-side; this helper types a display pair. */
export interface Money {
  cents: number
  currency: string
}
