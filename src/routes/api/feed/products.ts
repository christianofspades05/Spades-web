/**
 * Public Meta/Google Shopping-style product feed (RSS 2.0 + the `g:`
 * namespace both platforms share) — one brand per request via `?brand=`.
 *
 * Built because the store's existing Meta catalogs (Commerce Manager ->
 * Catalog -> Settings -> Data Sources) are still wired to the old Shopify
 * app integration from before this app replaced Shopify — so any product
 * added or changed here since the migration never reaches them. Point each
 * brand's catalog's Data Source at this URL instead (one per brand, e.g.
 * https://www.spades-official.com/api/feed/products?brand=spades), on a
 * schedule (Meta supports hourly/daily/weekly fetch).
 *
 * No auth — same as any other public storefront page; Meta's crawler
 * fetches this anonymously on its own schedule, and everything here is
 * already public via storefront RLS (active products/variants).
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  STOREFRONT_BRANDS,
  STOREFRONT_BRAND_LABELS,
} from '#/lib/validation/admin/storefront-sections'
import type { Brand } from '#/server/storefront/domain'

// getSupabaseAdminClient and domain helpers imported dynamically inside the
// handler below, not at the top level — same reasoning as
// api/cron/abandoned-cart.ts's identical comment: a `server.handlers`
// route doesn't get server-only code split out of the client bundle the
// way createServerFn does.

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function centsToPhpAmount(cents: number): string {
  return `${(cents / 100).toFixed(2)} PHP`
}

export const Route = createFileRoute('/api/feed/products')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const brandParam = url.searchParams.get('brand')
        if (
          !brandParam ||
          !(STOREFRONT_BRANDS as readonly string[]).includes(brandParam)
        ) {
          return new Response(
            `Missing or invalid ?brand= — must be one of: ${STOREFRONT_BRANDS.join(', ')}`,
            { status: 400 },
          )
        }
        const brand = brandParam as Brand

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { primaryHostnameFor } = await import(
          '#/server/storefront/domain'
        )
        const { fetchAllRows, chunkArray } = await import(
          '#/lib/utils/paginate'
        )
        const admin = getSupabaseAdminClient()

        const hostname = primaryHostnameFor(brand) ?? 'www.spades-official.com'
        const siteUrl = `https://${hostname}`

        const products = await fetchAllRows((offset) =>
          admin
            .from('products')
            .select('id, slug, name, description, images, product_type')
            .eq('brand', brand)
            .eq('status', 'active')
            .range(offset, offset + 999),
        )
        const productIds = products.map((p) => p.id)
        const productById = new Map(products.map((p) => [p.id, p]))

        const variants =
          productIds.length === 0
            ? []
            : (
                await Promise.all(
                  chunkArray(productIds, 200).map((ids) =>
                    fetchAllRows((offset) =>
                      admin
                        .from('product_variants')
                        .select(
                          'id, product_id, sku, size, color, style, price_cents, compare_at_price_cents, is_active, is_pre_order, pre_order_available',
                        )
                        .in('product_id', ids)
                        .eq('is_active', true)
                        .range(offset, offset + 999),
                    ),
                  ),
                )
              ).flat()
        const variantIds = variants.map((v) => v.id)

        const inventoryRows =
          variantIds.length === 0
            ? []
            : (
                await Promise.all(
                  chunkArray(variantIds, 200).map((ids) =>
                    fetchAllRows((offset) =>
                      admin
                        .from('inventory')
                        .select('variant_id, quantity_available')
                        .in('variant_id', ids)
                        .range(offset, offset + 999),
                    ),
                  ),
                )
              ).flat()
        const stockByVariantId = new Map<string, number>()
        for (const row of inventoryRows) {
          stockByVariantId.set(
            row.variant_id,
            (stockByVariantId.get(row.variant_id) ?? 0) + row.quantity_available,
          )
        }

        const brandLabel = STOREFRONT_BRAND_LABELS[brand]
        const items = variants
          // Meta rejects a non-positive price the same way it rejects one
          // on a pixel event (see checkout/index.tsx's InitiateCheckout
          // fix) — a $0 variant shouldn't be advertised either way.
          .filter((v) => v.price_cents > 0)
          .map((variant) => {
            const product = productById.get(variant.product_id)
            if (!product) return null

            const stock = stockByVariantId.get(variant.id) ?? 0
            const availability =
              stock > 0
                ? 'in stock'
                : variant.is_pre_order && variant.pre_order_available > 0
                  ? 'preorder'
                  : 'out of stock'

            const variantLabel = [variant.size, variant.color, variant.style]
              .filter(Boolean)
              .join(' / ')
            const title = variantLabel
              ? `${product.name} - ${variantLabel}`
              : product.name

            const hasSale =
              variant.compare_at_price_cents !== null &&
              variant.compare_at_price_cents > variant.price_cents

            return `  <item>
    <g:id>${escapeXml(variant.sku ?? variant.id)}</g:id>
    <g:item_group_id>${escapeXml(product.id)}</g:item_group_id>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(product.description ?? product.name)}</description>
    <link>${escapeXml(`${siteUrl}/products/${product.slug}`)}</link>
    <g:image_link>${escapeXml(product.images[0] ?? '')}</g:image_link>
    <g:availability>${availability}</g:availability>
    <g:price>${hasSale ? centsToPhpAmount(variant.compare_at_price_cents!) : centsToPhpAmount(variant.price_cents)}</g:price>
    ${hasSale ? `<g:sale_price>${centsToPhpAmount(variant.price_cents)}</g:sale_price>` : ''}
    <g:condition>new</g:condition>
    <g:brand>${escapeXml(brandLabel)}</g:brand>
    <g:product_type>${escapeXml(product.product_type)}</g:product_type>
    ${variant.color ? `<g:color>${escapeXml(variant.color)}</g:color>` : ''}
    ${variant.size ? `<g:size>${escapeXml(variant.size)}</g:size>` : ''}
  </item>`
          })
          .filter((item): item is string => item !== null)

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${escapeXml(brandLabel)} Product Feed</title>
  <link>${escapeXml(siteUrl)}</link>
  <description>${escapeXml(`${brandLabel} product catalog`)}</description>
${items.join('\n')}
</channel>
</rss>
`

        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            // Meta/Google re-fetch on their own schedule (hourly at the
            // fastest) — this just stops an accidental hammering of the DB
            // if something fetches it more often than that.
            'Cache-Control': 'public, max-age=1800',
          },
        })
      },
    },
  },
})
