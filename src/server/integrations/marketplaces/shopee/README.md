# integrations/marketplaces/shopee

Implemented, but **not yet exercised against a live or sandbox shop** — the
partner app (SyncMate) was just approved and every endpoint path/payload
shape below follows Shopee Open Platform v2's publicly documented
conventions rather than something that's actually been called. Treat the
first real "Connect" click, inventory push, and order pull as the real test;
check `sync_logs` for the raw response body if any of them fail, and adjust
`client.ts`/`adapter.ts` against Shopee's own API reference from there.

- `client.ts` — raw signed HTTP calls. Shopee signs requests with
  HMAC-SHA256 over `partner_id + api_path + timestamp` (+ `access_token` +
  `shop_id` for shop-level calls), keyed by the partner key.
  `SHOPEE_ENV` (see `.env.example`) picks Sandbox vs. Live — every new app
  starts in Sandbox until Shopee approves Live access for it.
- `adapter.ts` — implements `MarketplaceAdapter`. Registered in
  `../registry.ts`'s `ADAPTERS` map and `IMPLEMENTED_MARKETPLACES`, so the
  admin Channels page now offers a real "Connect" button.
- OAuth routes: `src/routes/api/oauth/shopee/connect.ts` (starts the flow)
  and `.../callback.ts` (exchanges the code). Unlike TikTok, Shopee's token
  exchange and refresh calls both require `shop_id` up front — that's why
  `MarketplaceAdapter.exchangeCodeForTokens`/`refreshTokens` take an
  optional second `shopId` parameter (TikTok's implementation ignores it).

Order import (`orders.source = 'shopee'`) and inventory push (via
`marketplace_product_mappings`) reuse the same `sync-engine.ts` — no engine
changes needed there.

**Known gap**: the admin Channels page (`src/routes/admin/channels/index.tsx`)
still hardcodes `marketplace: 'tiktok_shop'` in most of its server calls
(bulk sync, auto-connect, category browser, pull-orders-now) — only
disconnect already reads the marketplace off the card it's rendering. The
"Connect"/OAuth flow works correctly per-marketplace, but the rest of that
page needs to be parameterized by marketplace before Shopee can actually be
operated from it end-to-end.
