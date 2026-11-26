/**
 * Free gift deals (discounts.type 'free_gift'): once the cart holds at
 * least `min_quantity` eligible items, the customer picks one free item at
 * checkout from the products in the deal's `gift_collection_ids` (e.g.
 * Clearance or Essentials). One free item per order.
 *
 * The pick lives on the cart (carts.free_gift_variant_id) and is
 * re-validated on every cart load — still qualifying, still in the gift
 * collections, still in stock — so a stale pick quietly drops instead of
 * reaching an order. place-order.ts turns a valid pick into a ₱0 order line
 * and reserves its stock like any other line.
 */
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import { getActiveAutomaticDiscounts } from '#/server/storefront/automatic-sales'
import type { AutomaticDiscount } from '#/server/storefront/automatic-sales'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CartItemWithVariant } from '#/types/entities'
import type { ProductBrand } from '#/types/database.types'
import { eligibleItemsForDiscount, eligibleUnitCount } from './discount'

type Admin = ReturnType<typeof getSupabaseAdminClient>
type GiftDiscount = AutomaticDiscount & { min_quantity: number }

export interface FreeGiftPick {
  variantId: string
  productName: string
  variantLabel: string | null
  imageUrl: string | null
}

export interface FreeGiftOffer {
  discountId: string
  title: string
  minQuantity: number
  /** 0 once the cart qualifies. */
  itemsNeeded: number
  /** The customer's current pick — only ever set while the cart qualifies
   *  and the picked item is still a valid, in-stock gift. */
  pick: FreeGiftPick | null
}

export interface FreeGiftChoice {
  productId: string
  productName: string
  imageUrl: string | null
  variants: { variantId: string; label: string | null }[]
}

/** A validated gift variant, with what place-order needs for the line. */
export interface GiftVariant extends FreeGiftPick {
  sku: string
  costCents: number | null
}

function variantLabelOf(v: {
  size: string | null
  color: string | null
  style: string | null
}): string | null {
  return [v.size, v.color, v.style].filter(Boolean).join(' / ') || null
}

async function activeGiftDiscounts(admin: Admin): Promise<GiftDiscount[]> {
  return (await getActiveAutomaticDiscounts(admin)).filter(
    (d): d is GiftDiscount =>
      d.type === 'free_gift' &&
      d.min_quantity != null &&
      d.gift_collection_ids.length > 0,
  )
}

/**
 * The free gift deal this cart qualifies for (or is closest to), with the
 * customer's pick re-validated. Null when no free gift deal is running, or
 * for a pre-order cart (the gift ships now, a pre-order doesn't).
 */
export async function resolveFreeGiftOffer(
  admin: Admin,
  items: CartItemWithVariant[],
  pickedVariantId: string | null,
  brand: ProductBrand,
): Promise<FreeGiftOffer | null> {
  if (items.length === 0) return null
  if (items.some((item) => item.variant.is_pre_order)) return null
  const gifts = await activeGiftDiscounts(admin)
  if (gifts.length === 0) return null

  let best: { gift: GiftDiscount; itemsNeeded: number } | null = null
  for (const gift of gifts) {
    const eligible = await eligibleItemsForDiscount(admin, gift, items)
    const itemsNeeded = Math.max(
      0,
      gift.min_quantity - eligibleUnitCount(eligible),
    )
    // Prefer a deal the cart already qualifies for; among those, the one
    // with the highest threshold. Otherwise the one closest to unlocking.
    const better =
      !best ||
      (itemsNeeded === 0 && best.itemsNeeded > 0) ||
      (itemsNeeded === 0 &&
        best.itemsNeeded === 0 &&
        gift.min_quantity > best.gift.min_quantity) ||
      (itemsNeeded > 0 &&
        best.itemsNeeded > 0 &&
        itemsNeeded < best.itemsNeeded)
    if (better) best = { gift, itemsNeeded }
  }
  if (!best) return null

  const pick =
    best.itemsNeeded === 0 && pickedVariantId
      ? await giftVariantIfAllowed(admin, best.gift, pickedVariantId, brand)
      : null

  return {
    discountId: best.gift.id,
    title: best.gift.title,
    minQuantity: best.gift.min_quantity,
    itemsNeeded: best.itemsNeeded,
    pick: pick
      ? {
          variantId: pick.variantId,
          productName: pick.productName,
          variantLabel: pick.variantLabel,
          imageUrl: pick.imageUrl,
        }
      : null,
  }
}

/** The variant, if it's a valid free gift for this deal right now: active,
 *  sellable (not pre-order), in stock, its product active on this brand and
 *  in one of the deal's gift collections. */
export async function giftVariantIfAllowed(
  admin: Admin,
  gift: Pick<AutomaticDiscount, 'gift_collection_ids'>,
  variantId: string,
  brand: ProductBrand,
): Promise<GiftVariant | null> {
  const { data: variant, error } = await admin
    .from('product_variants')
    .select(
      'id, sku, size, color, style, cost_cents, is_active, is_pre_order, inventory(quantity_available), product:products(id, name, images, status, brand)',
    )
    .eq('id', variantId)
    .maybeSingle()
  if (error) throw error
  if (!variant || !variant.is_active || variant.is_pre_order || !variant.sku) {
    return null
  }
  const stock = variant.inventory.reduce(
    (sum, inv) => sum + inv.quantity_available,
    0,
  )
  if (stock < 1) return null
  const product = variant.product
  if (product.status !== 'active' || product.brand !== brand) return null
  const inCollections = await resolveCollectionScopedProductIds(
    admin,
    gift.gift_collection_ids,
    [product.id],
  )
  if (!inCollections.has(product.id)) return null

  return {
    variantId: variant.id,
    productName: product.name,
    variantLabel: variantLabelOf(variant),
    imageUrl: product.images[0] ?? null,
    sku: variant.sku,
    costCents: variant.cost_cents,
  }
}

const MAX_GIFT_CHOICES = 60

/** Every in-stock item the customer can pick as their free gift. */
export async function listGiftChoices(
  admin: Admin,
  gift: Pick<AutomaticDiscount, 'gift_collection_ids'>,
  brand: ProductBrand,
): Promise<FreeGiftChoice[]> {
  const { data: products, error } = await admin
    .from('products')
    .select(
      'id, name, images, variants:product_variants(id, sku, size, color, style, is_active, is_pre_order, inventory(quantity_available))',
    )
    .eq('status', 'active')
    .eq('brand', brand)
  if (error) throw error
  if (products.length === 0) return []

  const inCollections = await resolveCollectionScopedProductIds(
    admin,
    gift.gift_collection_ids,
    products.map((p) => p.id),
  )

  return products
    .filter((p) => inCollections.has(p.id))
    .map((p) => ({
      productId: p.id,
      productName: p.name,
      imageUrl: p.images[0] ?? null,
      variants: p.variants
        .filter(
          (v) =>
            v.is_active &&
            !v.is_pre_order &&
            Boolean(v.sku) &&
            v.inventory.reduce((sum, inv) => sum + inv.quantity_available, 0) >
              0,
        )
        .map((v) => ({ variantId: v.id, label: variantLabelOf(v) })),
    }))
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName))
    .slice(0, MAX_GIFT_CHOICES)
}

/** The active free gift deal by id — for callers that already have an
 *  offer and need the deal's own collections. */
export async function getActiveGiftDiscount(
  admin: Admin,
  discountId: string,
): Promise<GiftDiscount | null> {
  return (
    (await activeGiftDiscounts(admin)).find((d) => d.id === discountId) ?? null
  )
}
