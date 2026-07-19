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
