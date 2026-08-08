// Brief in-process cache so repeated loads of the same filters (e.g. every
// staff member landing on the default date range) don't re-run a full table
// scan each time. This only helps within a single warm serverless instance —
// it's not a shared/global cache — but Vercel reuses warm instances for
// bursts of traffic, which is exactly when this matters most. Same rationale
// as the existing cache in server/admin/orders.ts's getOrdersOverview.
export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, { expiresAt: number; data: T }>()

  return {
    get(key: string): T | undefined {
      const entry = store.get(key)
      if (entry && entry.expiresAt > Date.now()) return entry.data
      return undefined
    },
    set(key: string, data: T): void {
      store.set(key, { expiresAt: Date.now() + ttlMs, data })
    },
  }
}

// Same idea as createTtlCache, but caches the in-flight *promise* rather
// than the resolved value — see getActiveProductsForBrand in
// server/products/queries.ts for the fuller reasoning. Needed for anything
// called on every single storefront page load (maintenance mode, the promo
// banner, the email-capture flag, active automatic discounts): a plain
// value-only cache still lets a burst of concurrent visitors all miss at
// once and each fire their own DB round trip, since none of them has
// awaited far enough to populate a value-only cache before the others also
// reach it. Caching the promise means every concurrent caller within the
// TTL window awaits the exact same single DB round trip.
export function createPromiseCache<T>(ttlMs: number) {
  const store = new Map<string, { expiresAt: number; promise: Promise<T> }>()

  return {
    get(key: string, compute: () => Promise<T>): Promise<T> {
      const cached = store.get(key)
      if (cached && cached.expiresAt > Date.now()) return cached.promise

      const promise = compute()
      store.set(key, { expiresAt: Date.now() + ttlMs, promise })
      // A failed fetch shouldn't keep serving the same rejection to every
      // other caller for the rest of the TTL window — clear it so the next
      // call retries fresh instead of every caller erroring out together.
      promise.catch(() => store.delete(key))
      return promise
    },
  }
}
