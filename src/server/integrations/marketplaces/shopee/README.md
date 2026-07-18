# integrations/marketplaces/shopee

Implemented and OAuth-connected against the real Sandbox shop (SyncMate,
partner id 1238685) — the Connect flow, signing, and token exchange are all
confirmed working end-to-end. Inventory push, order pull, category
browsing, and product creation still haven't been exercised against a live
shop yet — treat those as the next real tests; check `sync_logs` for the
raw response body if any of them fail, and adjust `client.ts`/`adapter.ts`
against Shopee's own API reference from there.

- `client.ts` — raw signed HTTP calls. Shopee signs requests with
  HMAC-SHA256 over `partner_id + api_path + timestamp` (+ `access_token` +
  `shop_id` for shop-level calls), keyed by the partner key.
  `SHOPEE_ENV` (see `.env.example`) picks Sandbox vs. Live — every new app
  starts in Sandbox until Shopee approves Live access for it.
  **Sandbox host caveat**: every third-party SDK/guide referenced while
  building this used `partner.test-stable.shopeemobile.com` for sandbox —
  that host resolves and returns real-looking Shopee gateway responses, but
  rejects every request with `"Wrong sign"` regardless of signature
  correctness. The actual working sandbox host, confirmed via Shopee's own
  API Test Tool, is `openplatform.sandbox.test-stable.shopee.sg` (already
  set in `BASE_URLS`). If Live ever exhibits the same symptom, re-verify its
  host the same way (API Test Tool → switch Partner ID to the Live one) —
  `partner.shopeemobile.com` hasn't been confirmed the way sandbox's was.
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
