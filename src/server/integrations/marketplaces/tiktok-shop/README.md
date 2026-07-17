# integrations/marketplaces/tiktok-shop

Implemented ("SyncMate" — see the shared engine in `../sync-engine.ts` and
the `MarketplaceAdapter` interface in `../types.ts`).

- `client.ts` — raw signed HTTP calls to TikTok's Partner Center Open API
  (OAuth token exchange/refresh, inventory update, order search). This is
  the one file that knows TikTok's actual wire format.
- `adapter.ts` — implements `MarketplaceAdapter` using `client.ts`. Nothing
  outside this folder should ever import `client.ts` directly.

**Important caveat**: the request-signing algorithm and the order/inventory
endpoint payload shapes in these two files are implemented from TikTok's
publicly documented conventions, but Partner Center's own API reference is a
JS-rendered app that couldn't be scraped while building this. The first live
call will either work or come back with a clear error (signature mismatch,
unrecognized field) — see the comments at the top of `client.ts` for what to
check first.

OAuth connect flow: `src/routes/api/oauth/tiktok/connect.ts` (redirects to
TikTok) and `.../callback.ts` (exchanges the code, upserts the one
`marketplace_connections` row for `tiktok_shop`). Orders import into
`orders` with `source = 'tiktok_shop'` and `external_order_id` set (existing
unique index handles de-dupe). Inventory push resolves variants via
`marketplace_product_mappings.external_variant_id`, linked manually for now
from the admin Channels page (`/admin/channels`) — there's no "browse
TikTok's catalog and match SKUs" UI yet.

No webhook receiver yet — orders are pulled on a schedule instead (see
`src/routes/api/cron/sync-channels-pull-orders.ts`). Worth revisiting if
TikTok's webhook push is more reliable/timely than polling once this is
running against real traffic.
