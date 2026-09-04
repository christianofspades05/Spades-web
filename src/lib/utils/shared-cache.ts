/**
 * Wraps Vercel Runtime Cache (getCache() from @vercel/functions) with the
 * same get(key, compute) shape as createPromiseCache (see cache.ts) — a
 * cross-instance replacement for the specific caches in
 * src/server/collections/scoped-products.ts that a Sep 2026 traffic audit
 * confirmed as the dominant source of repeated Supabase reads: every warm
 * Fluid/Lambda instance kept its own process-local cache, so the same
 * collection-membership data was independently refetched by every
 * concurrently-active instance. Runtime Cache is shared by every instance
 * in a region (this project deploys to bom1 only), collapsing that
 * duplication down to roughly one real fetch per TTL window, site-wide,
 * instead of one per instance.
 *
 * Fails open, deliberately and always: a Runtime Cache outage, timeout, or
 * malformed stored value must never break the storefront. Every operation
 * (the getCache() factory call itself included — it can throw when no
 * cache context is available) is wrapped so a failure falls straight
 * through to `compute()`, exactly as if nothing were cached at all. A
 * failed write is swallowed outright — the caller already has its correct,
 * already-computed result in hand, so a cache-write failure must never
 * turn into a request failure.
 *
 * Phase 1 only: no active invalidation is wired up here — see
 * scoped-products.ts's own comments for what still bounds staleness.
 *
 * Single-flight dedup (added after the Phase 1 write-volume audit): a
 * process-local `Map<string, Promise<T>>` collapses concurrent callers on
 * the same warm instance requesting the same key into one shared
 * in-flight operation — mirroring what the old process-local
 * createPromiseCache got for free by caching the in-flight promise itself.
 * Runtime Cache has no equivalent of that: without this map, N concurrent
 * callers racing the same miss window each independently do their own
 * get/compute/set, multiplying writes by the fan-out factor (the
 * homepage's 13-way concurrent section load being the clearest case). The
 * map holds only *pending* operations — entries are removed in `finally`
 * the instant the leader settles (success or failure), so it never
 * retains completed results, never grows unbounded, and never becomes a
 * second TTL cache; a request that arrives after the leader has already
 * settled starts a fresh operation and goes through Runtime Cache again
 * like normal.
 */
import { getCache } from '@vercel/functions'

export function createSharedCache<T>(ttlSeconds: number) {
  const inFlight = new Map<string, Promise<T>>()

  return {
    get(
      key: string,
      compute: () => Promise<T>,
      options?: { tags?: string[]; isValid?: (value: unknown) => value is T },
    ): Promise<T> {
      const existing = inFlight.get(key)
      if (existing) return existing

      const operation = (async (): Promise<T> => {
        let cache: ReturnType<typeof getCache> | null = null
        try {
          cache = getCache()
        } catch (err) {
          console.error('Runtime Cache unavailable, falling back to direct compute:', err)
        }

        if (cache) {
          try {
            const cached = await cache.get(key)
            if (
              cached !== null &&
              cached !== undefined &&
              (!options?.isValid || options.isValid(cached))
            ) {
              return cached as T
            }
          } catch (err) {
            console.error(`Runtime Cache get() failed for key "${key}":`, err)
          }
        }

        const fresh = await compute()

        if (cache) {
          try {
            await cache.set(key, fresh, { ttl: ttlSeconds, tags: options?.tags })
          } catch (err) {
            console.error(`Runtime Cache set() failed for key "${key}":`, err)
          }
        }

        return fresh
      })().finally(() => {
        inFlight.delete(key)
      })

      inFlight.set(key, operation)
      return operation
    },
  }
}
