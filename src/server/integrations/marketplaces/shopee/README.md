# integrations/marketplaces/shopee

Not implemented yet — waiting on Shopee API account approval.

`adapter.ts` exists already (every method throws `AdapterNotImplementedError`)
so the registry (`../registry.ts`) and the admin Channels page can list
Shopee as "coming soon" without anything being callable. When credentials
are available, follow `../tiktok-shop/` as the template:

- Add a `client.ts` for the raw signed HTTP calls. Shopee's Open Platform
  API signs requests with HMAC-SHA256 over `partner_id + api_path +
timestamp` (+ `access_token` + `shop_id` for shop-level calls), keyed by
  the partner key — conceptually similar to TikTok's signing but with
  different parameters and endpoint shapes.
- Implement `MarketplaceAdapter` in `adapter.ts` using it.
- Nothing outside this folder and `../registry.ts` needs to change — add
  `shopee_adapter` to the registry's `ADAPTERS` map (it's already imported
  there, just currently pointing at the stub) and add `'shopee'` to
  `IMPLEMENTED_MARKETPLACES`.

Order import (`orders.source = 'shopee'`) and inventory push (via
`marketplace_product_mappings`) reuse the same `sync-engine.ts` — no engine
changes needed either.
