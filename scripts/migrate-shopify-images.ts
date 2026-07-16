/**
 * One-off migration: move every product/collection image still hosted on
 * Shopify's CDN (cdn.shopify.com) into this project's own 'product-images'
 * Supabase Storage bucket (the same bucket the admin image uploader writes
 * to — see uploadProductImage in src/server/admin/products.ts), then
 * rewrite the DB row to point at the new URL.
 *
 * Images live in two places in this schema — there is no per-variant image
 * column (see products.images comment in supabase/migrations/0001_init_schema.sql):
 *   - products.images       (jsonb array of URLs)
 *   - collections.image_url (single nullable URL)
 * Both are covered. Any URL not on cdn.shopify.com is left untouched, so
 * this is safe to re-run — already-migrated rows are simply skipped.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-shopify-images.ts [options]
 *
 * Options:
 *   --dry-run            Download and log what would happen; no uploads or DB writes.
 *   --limit=N            Only scan the first N rows per table (for testing).
 *   --concurrency=N      Concurrent downloads/uploads per batch (default 4).
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '#/types/database.types'

const STORAGE_BUCKET = 'product-images'
const DB_BATCH_SIZE = 50

interface Args {
  dryRun: boolean
  limit: number | null
  concurrency: number
}

function parseArgs(argv: string[]): Args {
  const limitArg = argv.find((a) => a.startsWith('--limit='))
  const concurrencyArg = argv.find((a) => a.startsWith('--concurrency='))
  return {
    dryRun: argv.includes('--dry-run'),
    limit: limitArg ? Number(limitArg.slice('--limit='.length)) : null,
    concurrency: concurrencyArg
      ? Number(concurrencyArg.slice('--concurrency='.length))
      : 4,
  }
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run this with ' +
        '`node --env-file=.env scripts/migrate-shopify-images.ts`.',
    )
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type SupabaseAdmin = ReturnType<typeof getAdminClient>

function isShopifyUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname === 'cdn.shopify.com' || hostname.endsWith('.cdn.shopify.com')
    )
  } catch {
    return false // not a valid absolute URL — nothing we can download anyway
  }
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

interface ImageMigrationResult {
  ok: boolean
  newUrl?: string
  error?: string
}

async function migrateOneImage(
  admin: SupabaseAdmin,
  sourceUrl: string,
  dryRun: boolean,
): Promise<ImageMigrationResult> {
  try {
    const response = await fetch(sourceUrl)
    if (!response.ok) {
      return { ok: false, error: `download failed: HTTP ${response.status}` }
    }
    const contentType = response.headers.get('content-type')
    const buffer = Buffer.from(await response.arrayBuffer())
    const extension = guessExtension(sourceUrl, contentType)
    const path = `${randomUUID()}.${extension}`

    if (dryRun) {
      return {
        ok: true,
        newUrl: `(dry-run, ${buffer.byteLength} bytes) -> ${path}`,
      }
    }

    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, buffer, { contentType: contentType ?? undefined })
    if (uploadError) {
      return { ok: false, error: `upload failed: ${uploadError.message}` }
    }

    const { data } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(path)
    return { ok: true, newUrl: data.publicUrl }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function withConcurrencyLimit<T, TResult>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

interface Failure {
  table: 'products' | 'collections'
  id: string
  label: string
  url: string
  error: string
}

async function migrateProductImages(
  admin: SupabaseAdmin,
  args: Args,
  failures: Failure[],
) {
  console.log('\n=== products.images ===')
  let offset = 0
  let scanned = 0
  let migrated = 0
  const scanLimit = args.limit ?? Infinity

  while (scanned < scanLimit) {
    const pageSize = Math.min(DB_BATCH_SIZE, scanLimit - scanned)
    const { data: products, error } = await admin
      .from('products')
      .select('id, slug, images')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (products.length === 0) break

    for (const product of products) {
      const images = product.images
      const targets = images
        .map((url, index) => ({ url, index }))
        .filter(({ url }) => isShopifyUrl(url))
      if (targets.length === 0) continue

      const outcomes = await withConcurrencyLimit(
        targets,
        args.concurrency,
        async ({ url, index }) => ({
          index,
          url,
          result: await migrateOneImage(admin, url, args.dryRun),
        }),
      )

      const nextImages = [...images]
      let changed = false
      for (const { index, url, result } of outcomes) {
        if (result.ok && result.newUrl) {
          migrated += 1
          console.log(
            `  [ok] ${product.slug} images[${index}] -> ${result.newUrl}`,
          )
          if (!args.dryRun) {
            nextImages[index] = result.newUrl
            changed = true
          }
        } else {
          failures.push({
            table: 'products',
            id: product.id,
            label: product.slug,
            url,
            error: result.error ?? 'unknown error',
          })
          console.error(
            `  [FAIL] ${product.slug} images[${index}] (${url}): ${result.error}`,
          )
        }
      }

      if (changed && !args.dryRun) {
        const { error: updateError } = await admin
          .from('products')
          .update({ images: nextImages })
          .eq('id', product.id)
        if (updateError) {
          failures.push({
            table: 'products',
            id: product.id,
            label: product.slug,
            url: '(saving updated images array)',
            error: updateError.message,
          })
          console.error(
            `  [FAIL] ${product.slug}: could not save updated images — ${updateError.message}`,
          )
        }
      }
    }

    scanned += products.length
    offset += products.length
    if (products.length < pageSize) break
  }

  console.log(`products: ${scanned} scanned, ${migrated} image(s) migrated.`)
}

async function migrateCollectionImages(
  admin: SupabaseAdmin,
  args: Args,
  failures: Failure[],
) {
  console.log('\n=== collections.image_url ===')
  let offset = 0
  let scanned = 0
  let migrated = 0
  const scanLimit = args.limit ?? Infinity

  while (scanned < scanLimit) {
    const pageSize = Math.min(DB_BATCH_SIZE, scanLimit - scanned)
    const { data: collections, error } = await admin
      .from('collections')
      .select('id, slug, image_url')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (collections.length === 0) break

    const targets = collections.filter(
      (c): c is typeof c & { image_url: string } =>
        !!c.image_url && isShopifyUrl(c.image_url),
    )

    const outcomes = await withConcurrencyLimit(
      targets,
      args.concurrency,
      async (collection) => ({
        collection,
        result: await migrateOneImage(admin, collection.image_url, args.dryRun),
      }),
    )

    for (const { collection, result } of outcomes) {
      if (result.ok && result.newUrl) {
        migrated += 1
        console.log(`  [ok] ${collection.slug} -> ${result.newUrl}`)
        if (!args.dryRun) {
          const { error: updateError } = await admin
            .from('collections')
            .update({ image_url: result.newUrl })
            .eq('id', collection.id)
          if (updateError) {
            failures.push({
              table: 'collections',
              id: collection.id,
              label: collection.slug,
              url: collection.image_url,
              error: updateError.message,
            })
            console.error(
              `  [FAIL] ${collection.slug}: could not save updated image_url — ${updateError.message}`,
            )
          }
        }
      } else {
        failures.push({
          table: 'collections',
          id: collection.id,
          label: collection.slug,
          url: collection.image_url,
          error: result.error ?? 'unknown error',
        })
        console.error(
          `  [FAIL] ${collection.slug} (${collection.image_url}): ${result.error}`,
        )
      }
    }

    scanned += collections.length
    offset += collections.length
    if (collections.length < pageSize) break
  }

  console.log(`collections: ${scanned} scanned, ${migrated} image(s) migrated.`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(
    `Shopify image migration — ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}, ` +
      `concurrency=${args.concurrency}${args.limit ? `, limit=${args.limit} row(s)/table` : ''}`,
  )

  const admin = getAdminClient()
  const failures: Failure[] = []

  await migrateProductImages(admin, args, failures)
  await migrateCollectionImages(admin, args, failures)

  console.log('\n=== Summary ===')
  if (failures.length === 0) {
    console.log('No failures.')
    return
  }

  console.log(`${failures.length} failure(s):`)
  for (const f of failures) {
    console.log(
      `  [${f.table}] ${f.label} (${f.id}) — ${f.url}\n    ${f.error}`,
    )
  }
  process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
