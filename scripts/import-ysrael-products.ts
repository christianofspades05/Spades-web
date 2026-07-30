/**
 * One-off import: brings the Ysrael brand's product catalog (exported from
 * its old Shopify store) into this app — creates each product, its
 * variants/inventory, downloads every product image from Shopify's CDN into
 * this project's own 'product-images' Supabase Storage bucket (same bucket
 * uploadProductImage writes to, and the same download/upload approach as
 * scripts/migrate-shopify-images.ts), and links every imported product to a
 * "Ysrael" collection (slug 'ysrael' — matches the collectionSlug already
 * hardcoded for the ysrael brand in src/server/storefront/domain.ts).
 *
 * Safe to re-run: products are looked up by slug first and skipped (not
 * duplicated) if they already exist.
 *
 * Usage:
 *   node --env-file=.env scripts/import-ysrael-products.ts [--dry-run]
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '#/types/database.types'

const STORAGE_BUCKET = 'product-images'
const COLLECTION_SLUG = 'ysrael'

function getAdminClient() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run this with ' +
        '`node --env-file=.env scripts/import-ysrael-products.ts`.',
    )
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type SupabaseAdmin = ReturnType<typeof getAdminClient>

function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

function guessExtension(url: string, contentType: string | null): string {
  if (contentType) {
    const mapped = EXTENSION_BY_CONTENT_TYPE[contentType.split(';')[0].trim()]
    if (mapped) return mapped
  }
  const pathname = new URL(url).pathname
  const fromPath = pathname.includes('.')
    ? pathname.split('.').pop()
    : undefined
  return fromPath && fromPath.length <= 5 ? fromPath.toLowerCase() : 'jpg'
}

/** Downloads `sourceUrl` and re-uploads it into our own storage bucket,
 *  returning the new public URL. Caches by source URL so an image reused
 *  across several products/variants is only fetched once. */
async function migrateImage(
  admin: SupabaseAdmin,
  sourceUrl: string,
  cache: Map<string, string>,
  dryRun: boolean,
): Promise<string> {
  const cached = cache.get(sourceUrl)
  if (cached) return cached

  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status} for ${sourceUrl}`)
  }
  const contentType = response.headers.get('content-type')
  const buffer = Buffer.from(await response.arrayBuffer())
  const extension = guessExtension(sourceUrl, contentType)
  const path = `${randomUUID()}.${extension}`

  if (dryRun) {
    const fakeUrl = `(dry-run, ${buffer.byteLength} bytes) -> ${path}`
    cache.set(sourceUrl, fakeUrl)
    return fakeUrl
  }

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: contentType ?? undefined })
  if (uploadError) {
    throw new Error(`upload failed: ${uploadError.message} for ${sourceUrl}`)
  }
  const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  cache.set(sourceUrl, data.publicUrl)
  return data.publicUrl
}

type ProductType =
  | 'tee'
  | 'polo'
  | 'hoodie'
  | 'jacket'
  | 'pants'
  | 'shorts'
  | 'accessory'
  | 'other'

interface VariantDef {
  size: string
  color?: string
  qty: number
}

interface ProductDef {
  title: string
  slug: string
  description: string
  productType: ProductType
  tags: string[]
  costPesos: number
  pricePesos: number
  compareAtPesos?: number
  images: string[]
  variants: VariantDef[]
}

const TEE_DESCRIPTION = `A bold declaration of faith and identity.
The Lamb features a distressed silkscreen print of the crucified Christ, crowned by a striking yellow cross. Beneath it, the name YSRAEL stands strong — symbolizing redemption, sacrifice, and grace.

Crafted from heavyweight CVC cotton, this piece blends durability with everyday comfort. Designed for believers who wear their faith loud, raw, and unapologetic.

Details:
- Fabric: Premium CVC (Chief Value Cotton)
- Weight: Heavyweight feel for structure and durability
- Print: High-quality silkscreen
- Fit: Standard streetwear cut
- Color: Jet Black with yellow and white print`

const POLO_HOODIE_DESCRIPTION = `Crafted for comfort, designed for faith.
This quarter-zip polo features a premium CVC cotton blend for a soft yet durable feel. Finished with high-quality silkscreen print, a genuine YKK zipper, and a boxy crop fit that brings a modern streetwear silhouette.`

const CDN = 'https://cdn.shopify.com/s/files/1/0894/7613/7144/files'
const BOXY_CROP_GENERIC = `${CDN}/BOXY_CROP_TSHIRT_NEW_983cc10d-b84b-4749-adf6-fe0018505e56.jpg?v=1763535619`

const SIZES = ['s', 'm', 'l', 'xl', '2xl', '3xl']

function sizeVariants(qtyBySize: Record<string, number>): VariantDef[] {
  return SIZES.map((size) => ({ size, qty: qtyBySize[size] ?? 0 }))
}

const PRODUCTS: ProductDef[] = [
  {
    title: 'I Called Jesus Boxy Crop Tee Black',
    slug: 'i-called-jesus-boxy-crop-tee-black',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: [],
    costPesos: 320,
    pricePesos: 650,
    images: [
      `${CDN}/ICALLEDJESUSBLACK.png?v=1763535619`,
      BOXY_CROP_GENERIC,
      `${CDN}/13.png?v=1763535605`,
      `${CDN}/11.png?v=1763535606`,
      `${CDN}/12.png?v=1763535605`,
    ],
    variants: sizeVariants({ s: 0, m: 0, l: 0, xl: 0, '2xl': 0, '3xl': 0 }),
  },
  {
    title: 'I Love Jesus Boxy Crop Tee Black',
    slug: 'i-love-jesus-boxy-crop-tee-black',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: [],
    costPesos: 320,
    pricePesos: 500,
    compareAtPesos: 650,
    images: [
      `${CDN}/YSRAEL_I_LOVE_JESUS.png?v=1758360936`,
      BOXY_CROP_GENERIC,
      `${CDN}/5.png?v=1758361784`,
      `${CDN}/1_53d15846-ccb8-4dcc-afde-8c80f6d843b7.png?v=1758361785`,
      `${CDN}/2_3bd1b5e7-ee1f-444f-b533-203fb2425922.png?v=1758361784`,
      `${CDN}/3_6b43705a-88a1-4f5c-9db3-b7b247166671.png?v=1758361785`,
      `${CDN}/4_eb1fe56c-221c-402b-9b3e-45d1486875e9.png?v=1758361785`,
    ],
    variants: sizeVariants({ s: 0, m: 0, l: 0, xl: 0, '2xl': 0, '3xl': 0 }),
  },
  {
    title: 'Jesus Saves Boxy Crop Tee White',
    slug: 'jesus-saves-boxy-crop-tee-white',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: [],
    costPesos: 320,
    pricePesos: 650,
    images: [
      `${CDN}/jesus_save_1.png?v=1758361733`,
      BOXY_CROP_GENERIC,
      `${CDN}/a3.png?v=1758365355`,
      `${CDN}/a4.png?v=1758365355`,
      `${CDN}/a1.png?v=1758365355`,
      `${CDN}/a2.png?v=1758365355`,
    ],
    variants: sizeVariants({ s: 0, m: 13, l: 2, xl: 0, '2xl': 0, '3xl': 0 }),
  },
  {
    title: 'Jesus Over Everything Tee Lavander',
    slug: 'jesus-over-everything-tee-lavander',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: ['PRE-ORDER'],
    costPesos: 320,
    pricePesos: 750,
    images: [
      `${CDN}/JESUS_OVER_EVERYTHING_LAVANDER.png?v=1779094410`,
      BOXY_CROP_GENERIC,
    ],
    variants: sizeVariants({ s: 2, m: 5, l: 7, xl: 7, '2xl': 4, '3xl': 1 }),
  },
  {
    title: 'Jesus Is My God Statement Tee Yellow',
    slug: 'jesus-is-my-god-statement-tee-yellow',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: ['PRE-ORDER'],
    costPesos: 320,
    pricePesos: 750,
    images: [`${CDN}/JESUS_SAVES_MUSTARD.png?v=1779094409`, BOXY_CROP_GENERIC],
    variants: sizeVariants({ s: 1, m: 5, l: 6, xl: 6, '2xl': 3, '3xl': 1 }),
  },
  {
    title: 'Jesus Saves Chenille Tee Black',
    slug: 'jesus-saves-chenille-tee-black',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: ['PRE-ORDER'],
    costPesos: 320,
    pricePesos: 750,
    images: [
      `${CDN}/JESUS_SAVES_YELLOW_DENIM_BLACK.png?v=1779094410`,
      BOXY_CROP_GENERIC,
    ],
    variants: sizeVariants({ s: 0, m: 2, l: 5, xl: 5, '2xl': 2, '3xl': 1 }),
  },
  {
    title: 'Only Jesus Can Quarter Zip Polo Shirt Black',
    slug: 'only-jesus-can-quarter-zip-polo-shirt-black',
    description: POLO_HOODIE_DESCRIPTION,
    productType: 'polo',
    tags: [],
    costPesos: 450,
    pricePesos: 900,
    images: [
      `${CDN}/YSRAELPOLOSHIRT.png?v=1763535911`,
      `${CDN}/POLOBOXYCROPNEW_6daa0812-4a3a-4e6a-8752-7ba96d7f51b9.png?v=1763535911`,
      `${CDN}/6.png?v=1763535909`,
      `${CDN}/2_00ad5966-56a6-41e9-b6fb-e79452570927.png?v=1763535907`,
      `${CDN}/3_3b8ab080-6cc4-416f-8612-8afc8b0d17d8.png?v=1763535908`,
      `${CDN}/4_af200c60-8f6d-4cac-9ae4-45e7be45afc7.png?v=1763535908`,
      `${CDN}/5_a18d8d3e-48e9-4f96-aa8b-fd475ff49ae4.png?v=1763535911`,
    ],
    variants: [
      { size: 'S', qty: 0 },
      { size: 'M', qty: 0 },
      { size: 'L', qty: 0 },
      { size: 'XL', qty: 0 },
      { size: '2XL', qty: 0 },
      { size: '3XL', qty: 0 },
    ],
  },
  {
    title: 'Only Jesus Can Quarter Zip Polo Shirt White',
    slug: 'only-jesus-can-quarter-zip-polo-shirt-white',
    description: POLO_HOODIE_DESCRIPTION,
    productType: 'polo',
    tags: [],
    costPesos: 450,
    pricePesos: 900,
    images: [
      `${CDN}/YSRAELPOLOSHIRTwhite.png?v=1763535713`,
      `${CDN}/9.png?v=1763535842`,
      `${CDN}/7.png?v=1763535842`,
      `${CDN}/8.png?v=1763535842`,
    ],
    variants: [
      { size: 'S', qty: 0 },
      { size: 'M', qty: 0 },
      { size: 'L', qty: 0 },
      { size: 'XL', qty: 0 },
      { size: '2XL', qty: 0 },
      { size: '3XL', qty: 0 },
    ],
  },
  {
    title: 'The Lamb Boxy Crop Tee Black',
    slug: 'the-lamb-boxy-crop-tee-black',
    description: TEE_DESCRIPTION,
    productType: 'tee',
    tags: [],
    costPesos: 320,
    pricePesos: 500,
    compareAtPesos: 650,
    images: [
      `${CDN}/YSRAELJHERIMIAHMOCKUPFINAL.png?v=1753806846`,
      `${CDN}/4.png?v=1753806846`,
      `${CDN}/1.png?v=1753806846`,
      `${CDN}/2.png?v=1753806846`,
      `${CDN}/3.png?v=1753806846`,
      BOXY_CROP_GENERIC,
    ],
    variants: sizeVariants({ s: 0, m: 0, l: 0, xl: 0, '2xl': 0, '3xl': 0 }),
  },
  {
    title: 'Trust Jesus Boxy Crop Hoodie',
    slug: 'trust-jesus-boxy-crop-hoodie',
    description: POLO_HOODIE_DESCRIPTION,
    productType: 'hoodie',
    tags: [],
    costPesos: 730,
    pricePesos: 1500,
    images: [
      `${CDN}/TRUSTJESUSPUFFMOSSGREEN.png?v=1763536418`,
      `${CDN}/TRUST_JESUS_PUFF_BROWN.png?v=1763536648`,
      `${CDN}/g8.png?v=1763536937`,
    ],
    variants: [
      { size: 'S', color: 'Moss Green', qty: 0 },
      { size: 'S', color: 'Choco Brown', qty: 2 },
      { size: 'M', color: 'Moss Green', qty: 0 },
      { size: 'M', color: 'Choco Brown', qty: 2 },
      { size: 'L', color: 'Moss Green', qty: 3 },
      { size: 'L', color: 'Choco Brown', qty: 0 },
      { size: 'XL', color: 'Moss Green', qty: 0 },
      { size: 'XL', color: 'Choco Brown', qty: 0 },
      { size: '2XL', color: 'Moss Green', qty: 9 },
      { size: '2XL', color: 'Choco Brown', qty: 2 },
      { size: '3XL', color: 'Moss Green', qty: 1 },
      { size: '3XL', color: 'Choco Brown', qty: 0 },
    ],
  },
]

async function ensureCollection(
  admin: SupabaseAdmin,
  dryRun: boolean,
): Promise<string> {
  const { data: existing, error } = await admin
    .from('collections')
    .select('id')
    .eq('slug', COLLECTION_SLUG)
    .maybeSingle()
  if (error) throw error
  if (existing) {
    console.log(
      `Collection '${COLLECTION_SLUG}' already exists (${existing.id}).`,
    )
    return existing.id
  }

  if (dryRun) {
    console.log(`[dry-run] would create collection '${COLLECTION_SLUG}'`)
    return '(dry-run-collection-id)'
  }

  const { data: created, error: createError } = await admin
    .from('collections')
    .insert({
      slug: COLLECTION_SLUG,
      name: 'Ysrael',
      description: null,
      image_url: null,
      is_active: true,
      sort_order: 0,
      hide_out_of_stock_products: false,
      match_type: 'all',
      rules: [],
      sort_by: 'title_asc',
    })
    .select('id')
    .single()
  if (createError) throw createError
  console.log(`Created collection '${COLLECTION_SLUG}' (${created.id}).`)
  return created.id
}

// The full slug, not an acronym — an acronym truncated to a fixed length
// collided between "...polo-shirt-black" and "...polo-shirt-white" (both
// reduce to the same first-6-initials), so use something guaranteed unique
// per product (the slug already has a DB uniqueness constraint of its own).
function slugForSku(slug: string): string {
  return slug.toUpperCase()
}

async function importProduct(
  admin: SupabaseAdmin,
  def: ProductDef,
  collectionId: string,
  imageCache: Map<string, string>,
  dryRun: boolean,
) {
  const { data: existing, error: existingError } = await admin
    .from('products')
    .select('id')
    .eq('slug', def.slug)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    console.log(`  [skip] ${def.slug} already exists (${existing.id})`)
    return
  }

  console.log(`  Importing ${def.slug} (${def.images.length} image(s))...`)
  const uploadedImages: string[] = []
  for (const url of def.images) {
    try {
      uploadedImages.push(await migrateImage(admin, url, imageCache, dryRun))
    } catch (err) {
      console.error(`    [FAIL] image ${url}:`, err)
    }
  }

  if (dryRun) {
    console.log(
      `  [dry-run] would create product '${def.title}' with ${def.variants.length} variant(s), images:`,
      uploadedImages,
    )
    return
  }

  const { data: product, error: productError } = await admin
    .from('products')
    .insert({
      slug: def.slug,
      name: def.title,
      description: def.description,
      product_type: def.productType,
      status: 'active',
      images: uploadedImages,
      tags: def.tags,
    })
    .select('id')
    .single()
  if (productError) throw productError

  const priceCents = pesosToCents(def.pricePesos)
  const compareAtCents =
    def.compareAtPesos !== undefined && def.compareAtPesos > def.pricePesos
      ? pesosToCents(def.compareAtPesos)
      : null
  const skuPrefix = `YSRAEL-${slugForSku(def.slug)}`

  for (const variant of def.variants) {
    const skuParts = [skuPrefix, variant.size, variant.color]
      .filter(Boolean)
      .map((s) => String(s).replace(/\s+/g, ''))
    const sku = skuParts.join('-').toUpperCase()

    const { data: variantRow, error: variantError } = await admin
      .from('product_variants')
      .insert({
        product_id: product.id,
        sku,
        size: variant.size,
        color: variant.color ?? null,
        style: null,
        price_cents: priceCents,
        compare_at_price_cents: compareAtCents,
        weight_grams: 250,
        is_active: true,
      })
      .select('id')
      .single()
    if (variantError) throw variantError

    const { error: inventoryError } = await admin.from('inventory').insert({
      variant_id: variantRow.id,
      location_code: 'main',
      quantity_on_hand: variant.qty,
    })
    if (inventoryError) throw inventoryError
  }

  const { error: linkError } = await admin.from('product_collections').insert({
    product_id: product.id,
    collection_id: collectionId,
    sort_order: 0,
  })
  if (linkError) throw linkError

  console.log(`  [ok] ${def.slug} created (${product.id})`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(
    `Ysrael product import — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`,
  )

  const admin = getAdminClient()
  const collectionId = await ensureCollection(admin, dryRun)
  const imageCache = new Map<string, string>()

  for (const def of PRODUCTS) {
    await importProduct(admin, def, collectionId, imageCache, dryRun)
  }

  console.log('\nDone.')
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
