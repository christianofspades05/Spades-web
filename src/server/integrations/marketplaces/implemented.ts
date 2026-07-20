import type { MarketplaceName } from '#/types/entities'

/**
 * Marketplaces with a real (non-stub) adapter — drives what the admin
 * Channels page offers to connect. Deliberately kept in its own file with
 * zero adapter imports: registry.ts imports every platform's real adapter
 * (tiktok-shop/adapter.ts -> client.ts uses node:crypto, a Node-only
 * module), which is fine for server-only callers but breaks the client
 * bundle for anything that imports it from a route file — confirmed live:
 * routes/admin/channels/$marketplace.tsx only ever needed this one list,
 * not the adapters themselves, and importing it from registry.ts pulled in
 * node:crypto client-side, which Vite can't polyfill and throws on.
 */
export const IMPLEMENTED_MARKETPLACES: MarketplaceName[] = [
  'tiktok_shop',
  'shopee',
]
