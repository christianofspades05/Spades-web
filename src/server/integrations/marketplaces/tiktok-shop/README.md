# integrations/marketplaces/tiktok-shop

Not implemented yet.

Planned scope: OAuth connect flow (writes to `marketplace_connections`,
storing encrypted tokens), order import (creates `orders` with
`source = 'tiktok_shop'` and `external_order_id` set for de-dupe),
inventory push using `marketplace_product_mappings` to resolve internal
variant IDs, and a webhook receiver under `server/webhooks` for order/status
events.
