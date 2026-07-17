# integrations/marketplaces/lazada

Not implemented yet — waiting on Lazada Open Platform API account approval.

Same shape as `../shopee/README.md`: `adapter.ts` exists as a stub (every
method throws `AdapterNotImplementedError`) so the registry and admin
Channels page can list it as "coming soon." Lazada's Open Platform signs
requests with HMAC-SHA256 over the app secret + API path + sorted params,
similar in spirit to TikTok Shop's signing — follow `../tiktok-shop/` as the
template: a `client.ts` for the raw signed calls, then `adapter.ts`
implementing `MarketplaceAdapter` using it, then register it in
`../registry.ts`. `sync-engine.ts` and the admin UI need no changes.
