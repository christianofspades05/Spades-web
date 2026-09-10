# Channels (Shopee / TikTok Shop) — how it works

This is the reference doc for the admin "Channels" feature: marketplace
OAuth connections, inventory/price sync, order/return pulls, and the
reconnect/repair tools. Read this before debugging a channels problem
instead of re-deriving the architecture from scratch.

## Where the code lives

| Piece | File |
|---|---|
| Adapter contract every marketplace implements | `src/server/integrations/marketplaces/types.ts` |
| Platform-agnostic orchestrator (all the actual sync logic) | `src/server/integrations/marketplaces/sync-engine.ts` |
| Marketplace name → adapter lookup | `src/server/integrations/marketplaces/registry.ts` |
| Which marketplaces have a real adapter (client-safe, no adapter imports) | `src/server/integrations/marketplaces/implemented.ts` |
| Shopee adapter | `src/server/integrations/marketplaces/shopee/adapter.ts` (+ `client.ts`, `README.md`) |
| TikTok Shop adapter | `src/server/integrations/marketplaces/tiktok-shop/adapter.ts` (+ `client.ts`, `README.md`) |
| Lazada adapter | `src/server/integrations/marketplaces/lazada/adapter.ts` (stub — see below) |
| Admin server functions (what the UI calls) | `src/server/admin/channels.ts` |
| Admin UI — connection cards, per-marketplace management page | `src/components/admin/channel-sync.tsx`, `src/routes/admin/channels/index.tsx`, `src/routes/admin/channels/$marketplace.tsx` |
| OAuth connect/callback routes | `src/routes/api/oauth/{shopee,tiktok}/{connect,callback}.ts` |
| Cron triggers | `src/routes/api/cron/sync-channels-daily.ts`, `src/routes/api/cron/sync-channels-pull-orders.ts` |
| Diagnostic log of every sync attempt | `sync_logs` table |

**Lazada is not live** — `lazada/adapter.ts` exists as a stub and is not in
`IMPLEMENTED_MARKETPLACES`, so it never appears as connectable in the admin
UI. Only Shopee and TikTok Shop are real today.

## The adapter contract

`sync-engine.ts` never imports a specific platform's client directly — it
only calls through the `MarketplaceAdapter` interface
(`types.ts`). Adding a new marketplace means writing one file that
implements this interface plus one line in `registry.ts`, not touching the
engine or the admin UI.

Every adapter implements: `getAuthorizationUrl`, `exchangeCodeForTokens`,
`refreshTokens`, `pushInventory`, `pullOrders`, `mapOrderToInternalFormat`,
`pullReturns`, `mapReturnToInternalFormat`, `listCategories`,
`getCategoryAttributes`, `createProduct`, `updateFulfillment`,
`getProductByExternalId`, `listProducts`.

Two methods are **optional** and not every adapter has them:

- **`updatePrice?`** — pushes a live selling-price update to the platform.
  Implemented by Shopee and TikTok Shop; not by Lazada. If an adapter
  doesn't implement it, price sync silently no-ops for that marketplace
  (see "Price sync" below).
- **`pullOrdersByIds?`** — fetches specific orders by platform id, bypassing
  the normal "list changed orders since X" search. Implemented only for
  TikTok Shop, because its `update_time_ge` search has been observed to
  sometimes not re-surface an order that actually changed (e.g. a tracking
  number attached after collection, or a platform-side auto-cancellation),
  even within the lookback window. Used by `reconcileNonTerminalOrders` (see
  below) as a fallback for orders stuck in a non-final state.

## Trigger mechanisms — two crons, deliberately split

This Vercel plan caps a project at **2 cron jobs, each at most once a
day**. That constraint shapes both trigger routes:

1. **`sync-channels-daily.ts`** (Vercel Cron, `vercel.json`: `"0 3 * * *"`)
   — **this runs at 3 AM UTC, which is 11 AM Philippine time**, not 3 AM PH.
   Protected by `CRON_SECRET` bearer auth (`Authorization: Bearer
   $CRON_SECRET`). For every `active` connection, sequentially:
   `pullOrdersForMarketplace` → `pullReturnsForMarketplace` →
   `pushInventoryForAllProducts` → `pushPriceForAllProducts` →
   `reconcileNonTerminalOrders`, each independently try/caught (one
   marketplace's failure doesn't block another's steps, and one step's
   failure doesn't skip the rest). Lookback window is 26 hours (wider than
   the 24h interval, so one missed/failed run doesn't lose orders — pulling
   the same order twice is a safe no-op via `orders.external_order_id`
   dedup).
2. **`sync-channels-pull-orders.ts`** — **not** registered in
   `vercel.json**, deliberately. It's meant to be triggered externally every
   few minutes by **cron-job.org**, protected by a *separate* secret,
   `CRON_JOB_ORG_SECRET` (intentionally distinct from `CRON_SECRET` — see
   the `cron-secret-split` memory note; don't merge these back into one).
   This is what actually gives near-real-time order pulls despite the daily
   cron's 2-job cap — it bypasses the cap entirely because it's not a
   Vercel Cron at all. Only pulls orders + returns (15-minute lookback);
   does **not** touch inventory, price, or stale-order reconciliation. The
   daily cron still runs pull-orders too, as a fallback in case the
   external scheduler ever stops firing.

**Manual trigger caveat**: hitting either endpoint by hand with `curl`
reliably times out client-side (HTTP 000) while the work keeps running
server-side for many minutes (a full daily-cron pass over ~900+ mappings
per marketplace can take 20+ minutes). Don't re-trigger repeatedly while
waiting — overlapping runs make `sync_logs` hard to attribute to a specific
invocation. Poll `sync_logs` for fresh rows instead of re-curling.

## The five sync steps, per connection

All defined in `sync-engine.ts`, all called from the daily cron loop:

1. **`pullOrdersForMarketplace`** — fetches new/changed orders via
   `adapter.pullOrders`, normalizes each via `mapOrderToInternalFormat`, and
   imports via `importOrder` (dedup on `external_order_id`; customer
   matched/created via a case-insensitive `.ilike()` email lookup — see
   "Gotcha: customer email lookup" below).
2. **`pullReturnsForMarketplace`** — same shape, for buyer return/refund
   requests (`pullReturns` / `mapReturnToInternalFormat` / `importReturn`).
3. **`pushInventoryForAllProducts`** — pushes current stock for every
   mapped variant via `adapter.pushInventory`. Gated per-connection on
   `marketplace_connections.inventory_sync_enabled` (off by default — a
   channel may already have its stock managed by another tool, e.g. an old
   Shopify-side sync app; pushing uninvited risks overwriting that).
   Turning the toggle **on** in admin immediately triggers a one-time full
   push, so enabling isn't a silent no-op until the next scheduled sync.
   Inventory sync is **push-only** — there's no "read platform inventory"
   adapter method, so if stock is changed directly on the marketplace by
   some other means, our side won't see it; last-write-wins from our side
   on every sync.
4. **`pushPriceForAllProducts`** — see "Price sync" below.
5. **`reconcileNonTerminalOrders`** — for orders still sitting in a
   non-final status, re-checks them directly by id (via
   `pullOrdersByIds` where the adapter has it — currently only TikTok) to
   catch a status change that the normal time-window pull might have
   missed.

Every step logs to `sync_logs` (see "Diagnosing a sync problem" below).

## Price sync (markup + automatic sale mirroring)

Originally, a previous Shopify + Shopee connector meant that setting up a
storefront sale automatically dropped Shopee's price by the same
percentage. The current integration reproduces that:

- **Markup, not 1:1.** Shopee/TikTok's *regular* (non-sale) price is never
  the same as the storefront price — it's marked up by a fixed percentage
  configured per connection (`marketplace_connections.price_markup_percent`,
  editable in admin next to the connection's sync toggle — e.g. currently
  15% for both Shopee and TikTok). So: `markedUpPriceCents = round(variant.price_cents
  * (1 + price_markup_percent / 100))`.
- **Sale mirroring.** If a storefront **automatic** discount
  (`discounts.kind = 'automatic'` — never a discount *code*, which is never
  storefront-wide) is currently active, the sale percentage/amount is
  applied **on top of the marked-up price**, not the raw storefront price —
  computed via `resolveSalePrices` against a **freshly-queried** (not the
  15s-cached storefront read) list of active discounts, so a sync
  immediately after a discount save doesn't see stale data. When no sale is
  active, price reverts to the marked-up regular price.
- **Rounding differs by platform.** Shopee sends the price as a plain
  decimal (`original_price: priceCents / 100`, e.g. `745.19`). TikTok's
  adapter additionally **rounds to the nearest whole peso** before sending
  (`Math.round(priceCents / 100)` → `745`), added specifically because
  TikTok listings looked odd with kobo-precision prices. This is a
  deliberate, platform-specific difference — don't "fix" it into matching
  Shopee's behavior without being asked.
- **Off by default**, gated on `marketplace_connections.price_sync_enabled`
  (same reasoning as inventory sync — another tool might already own
  price). Turning it on, or changing the markup %, immediately triggers a
  one-time full re-push (same "not a silent no-op" pattern as inventory).
- **Two trigger paths**:
  - **Admin-triggered** (the common case: staff creates/edits/toggles an
    automatic discount, or an admin toggles price-sync/changes markup) —
    syncs **immediately**, via `syncMarketplacePricesIfAutomatic` in
    `src/server/admin/discounts.ts`, called after `createDiscount`,
    `updateDiscount`, and `setDiscountActive`.
  - **Purely time-scheduled** discount transitions (a discount's own
    `starts_at`/`ends_at` firing with no admin click at that moment) are
    only caught by the **daily cron** — meaning a scheduled sale start/end
    can take up to ~24h to reflect on a marketplace unless staff also
    manually toggles something. This is a known, accepted latency
    tradeoff, not a bug — it exists because the 2-cron-job cap prevents a
    tighter dedicated schedule.
- **Full-catalog resync, every time.** A discount save always re-prices
  every mapped product for every implemented marketplace (concurrency-5,
  same pattern as inventory push) — it does not try to narrow the resync
  to only the products a changed discount affects. At current catalog size
  (~900+ mappings per marketplace) this is accepted as correctness-over-cost;
  revisit only if it starts hitting marketplace rate limits.
- **Logged as** `sync_logs.operation = 'push_price'`.

## Revalidate connections / Connect existing product

Mappings (`marketplace_product_mappings`, one row per variant per
marketplace: `external_product_id` + `external_variant_id`) can drift —
e.g. a listing gets recreated on the marketplace side, or was never fully
connected in the first place. Two related admin tools repair this:

- **"Revalidate connections"** (bulk, per-marketplace) — re-matches every
  mapped product against its live marketplace listing (title + variant
  option-value matching, exact and case-sensitive). Logs a per-product row
  as `connect_existing_product` and a summary row as `revalidate_mappings`.
  Real failure modes seen in production: *"Variant mismatch: SKU (label) —
  no matching variant found"* (a size/color option on our side doesn't
  exactly match any option the platform reports) and *"Title doesn't match
  exactly — ours: '...', theirs: '...'"* (even a stray extra space in a
  marketplace listing title breaks the exact match). These require a
  manual catalog title/variant fix — the tool won't force a fuzzy match.
- **"Connect existing product"** (single product, manual) — same matching
  logic, staff-invoked, used when a specific product has real stock on our
  side but no marketplace mapping at all yet (see
  `marketplace-stale-variant-mappings` memory note — the recommended first
  move whenever a variant looks disconnected).
- **`autoConnectProductsByTitle` / `autoConnectProductsBySku`** — bulk
  auto-connect passes that try to link currently-unmapped products by
  matching title or SKU against the platform's own `listProducts` catalog.

None of these tools invent a marketplace listing — a product that was
never actually created on Shopee/TikTok in the first place has to be
pushed there first (`pushNewProductToMarketplace` / `createProduct`)
before any of the above can connect to it.

## Diagnosing a sync problem — read `sync_logs` first

Columns: `marketplace`, `operation` (`pull_orders`, `pull_returns`,
`push_inventory`, `push_price`, `reconcile_stale_orders`,
`sync_cancellation`, `connect_existing_product`, `revalidate_mappings`,
`refresh_token`), `status` (`success`/`failed`), `detail` (jsonb — e.g.
`{mappingId, priceCents, attempt}` for `push_price`), `error_message`,
`created_at`.

**Important**: failed operations retry (up to a fixed max attempts), so
raw failed-row counts are inflated — the same mapping can log several
failed attempts before either succeeding or giving up. To get the real
count of **permanently** failed mappings, group by `detail->>'mappingId'`
and check `bool_or(status = 'success')` — a mapping with any successful
attempt in the window is fine, not failed. This distinction has mattered
every time this has been audited; don't report raw failed-row counts to
the user as if they were distinct failures.

A large batch of `external_product_id: null` failures usually means those
mappings were **never fully connected** in the first place (not drift) —
distinguish this from a mapping that has a real external id but still
fails, which usually is drift and is what "Revalidate connections" fixes.

## Known gotcha: customer email lookup must be case-insensitive

`customers_email_key` is a **unique index on `lower(email)`** — a separate,
non-unique `customers_email_idx` also exists on the raw `email` column,
which is easy to mistake for the uniqueness source. Any code that looks up
a customer via `.eq('email', ...)` compares case-sensitively against the
raw column, so it can permanently miss an existing customer stored with
different casing — every subsequent call then falls through to an insert
and crashes into the case-insensitive unique constraint, forever (the
lookup can never find the row to use instead). This actually happened
live: a TikTok order failed to import on every single daily sync for 12+
days straight before being caught and fixed.

**The fix, already correct in `email-capture.ts` and now also in
`sync-engine.ts`'s order import and `place-order.ts`'s checkout customer
lookup:**

```ts
.ilike('email', email.replace(/[%_]/g, '\\$&'))
```

(escaping `%`/`_` so it stays an exact match, not a pattern search). If a
new customer-lookup-by-email call site ever shows up, check it against
this pattern before assuming it's safe — see the
`customer-email-case-sensitivity` memory note for the full history.

## OAuth connections

- Connect: `/api/oauth/{shopee,tiktok}/connect` → `adapter.getAuthorizationUrl`.
- Callback: `/api/oauth/{shopee,tiktok}/callback` → `adapter.exchangeCodeForTokens`,
  stores tokens on `marketplace_connections`.
- Refresh: `ensureFreshConnection` (sync-engine.ts) checks
  `token_expires_at` before any adapter call and calls `adapter.refreshTokens`
  proactively, logging `refresh_token`.
- **TikTok-specific**: TikTok connections carry a `shop_cipher`, an opaque
  per-shop value required on every signed request in addition to the shop
  id. If a TikTok connection shows as `active` but is missing
  `shop_cipher`, the admin UI surfaces a warning — product/order sync will
  fail until the app permissions are fixed and the shop is
  disconnected/reconnected. This is not the same issue as the old "invalid
  sign param" TikTok signing bug (confirmed resolved as of 2026-08-01 — if
  you see a stale note claiming otherwise, it's outdated).
- Connection `status` values: `active`, `expired` (needs a refresh — should
  self-heal via `ensureFreshConnection` on the next sync attempt),
  `revoked` (not connected), `error`.

## Quick mental model for "why isn't X syncing"

1. Is the connection `active`? Check `marketplace_connections.status` and
   `token_expires_at`.
2. Is the relevant sync flag on? `inventory_sync_enabled` /
   `price_sync_enabled` — both off by default per connection.
3. Check `sync_logs` for that marketplace/operation, grouped to collapse
   retries, in the relevant time window.
4. If a specific product/variant is affected: is
   `marketplace_product_mappings.external_product_id` /
   `external_variant_id` populated? If null, it was never connected — use
   "Connect existing product." If populated but still failing, it's likely
   drift — use "Revalidate connections" and read the specific mismatch
   reason it reports.
5. Remember the daily cron runs at 11 AM Philippine time, not 3 AM — if
   something "should have synced overnight" and didn't, check whether
   enough wall-clock time has actually passed since 11 AM.
