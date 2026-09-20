# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Spades is a production ecommerce platform (Philippine streetwear) built to replace a Shopify store. It is **not** a scaffold — storefront, checkout, admin dashboard, and marketplace sync are all live and under active daily development (see `git log`). `README.md` and most `src/server/*/README.md` / `src/components/*/README.md` files were written when the project *was* a scaffold and say "not implemented yet" for domains (cart, checkout, orders, customers, admin, most component folders) that are now fully built — **do not trust those READMEs' implementation-status claims; check the actual source**. The two READMEs that are still accurate are `src/server/integrations/profitmate/README.md` and `src/server/integrations/shipmate/README.md` — those are genuinely unbuilt, separate future products. `docs/channels-integration.md` is accurate and actively maintained — read it before touching marketplace sync.

**Stack:** TanStack Start (React 19, file-based router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Storage) · Vercel · Zod · Vitest

## Commands

```bash
npm run dev              # dev server on :3000
npm run build             # production build
npm run preview           # preview a production build
npm run test               # vitest run (whole suite)
npx vitest run path/to/file.test.ts   # single test file
npx vitest path/to/file.test.ts       # single file, watch mode
npm run lint                # eslint
npm run format               # prettier --write . && eslint --fix
npm run check                 # prettier --check . (no writes)
npm run generate-routes        # tsr generate — regenerate src/routeTree.gen.ts after adding/moving a route file
```

No dedicated vitest config file exists; environment defaults to Node. Tests that need a DOM (component tests) opt in per-file with `// @vitest-environment jsdom` as the first line (see `src/components/storefront/ProductCard.test.tsx`).

Both `package-lock.json` and `pnpm-lock.yaml` are present; `pnpm-workspace.yaml` pins `@tanstack/router-core` via `overrides` to keep a single copy across the dependency tree (a split copy previously caused `useRouteContext()` to intermittently return `undefined` mid-navigation) — don't remove that override without understanding why it's there.

## Path aliases

`#/*` and `@/*` both map to `./src/*` (tsconfig `paths` + a matching `imports` field in `package.json`). `#/*` is the one used throughout existing code.

## Architecture

### The three Supabase clients — this is the most important thing to get right

- `src/lib/supabase/client.ts` — browser client, anon key. `VITE_`-prefixed env vars only.
- `src/lib/supabase/server.ts` — per-request server client, anon key + the caller's auth cookies, **respects RLS**. Use inside server functions/loaders for anything that should reflect "who is asking" (e.g. a customer reading their own orders). Must be called from within a request context (reads cookies via `@tanstack/react-start/server`).
- `src/lib/supabase/admin.ts` — service-role client, **bypasses RLS entirely**. `getSupabaseAdminClient()` throws if called from `window !== undefined` as defense-in-depth, but the real protection is discipline: only import this from `src/server/**` code running inside a `createServerFn` handler, never from a route component or anything that could reach the client bundle. `SUPABASE_SERVICE_ROLE_KEY` must never get a `VITE_` prefix — that prefix is the actual client/server boundary Vite enforces, not just a convention.

Every mutation that touches prices, inventory, orders, or payments must go through the admin client from server-only code, with input validated first — the admin client trusts whatever it's told, by design.

### Auth guards

`src/lib/auth/guards.ts` exports `requireCustomer()` and `requireStaff([...roles])`, both throwing (`UnauthorizedError` / `ForbiddenError`) rather than returning null/false. Every admin server function must call `requireStaff([...allowedRoles])` before touching the admin Supabase client, and should write to `activity_logs` for any mutation.

### Money and inventory invariants

- Prices are integer cents (`product_variants.price_cents`), read/written **only** server-side. Never accept a price from the client — order totals are always recomputed server-side at checkout, never trusted from the submitted cart.
- Inventory changes go through the atomic Postgres functions `reserve_variant_stock` / `commit_variant_stock` / `release_variant_stock` (defined in `supabase/migrations/0001_init_schema.sql`), never a plain `UPDATE inventory SET quantity_on_hand = ...` — that reintroduces the overselling race condition those functions exist to prevent.
- Webhook handlers (payment provider, marketplace) insert into `webhook_events` first and rely on its `unique (source, external_event_id)` constraint for idempotency before doing any side effects.

### Server functions, by domain (`src/server/`)

TanStack Start `createServerFn` functions, organized by domain: `products/`, `collections/`, `cart/`, `checkout/` (place-order, PayPal capture, Lalamove), `orders/`, `account/`, `customers/`, `admin/` (products, orders, customers, inventory, discounts, analytics, channels, settings, ...), `storefront/` (banners, maintenance mode, market pricing, currency bootstrap, automatic sales), `reviews/`, `currency/`, `feedback/`, `webhooks/`, `integrations/marketplaces/`. Input validation schemas live in `src/lib/validation/` (Zod).

### Marketplace sync (`src/server/integrations/marketplaces/`)

Full reference: `docs/channels-integration.md` — read it before debugging anything here. Key points:

- `sync-engine.ts` is the platform-agnostic orchestrator; it never imports a platform's client directly, only the `MarketplaceAdapter` interface (`types.ts`).
- `registry.ts` maps `MarketplaceName` → adapter. Adding a marketplace means writing one adapter file + one line in `registry.ts`.
- `implemented.ts` holds `IMPLEMENTED_MARKETPLACES` (client-safe, no Node-only adapter imports) — the admin Channels UI imports from here, not from `registry.ts`.
- Shopee and TikTok Shop are live. Lazada is a stub (`lazada/adapter.ts` exists but isn't in `IMPLEMENTED_MARKETPLACES`) and never appears as connectable in the admin UI.
- Two optional adapter methods: `updatePrice?` (Shopee, TikTok Shop only — silently no-ops elsewhere) and `pullOrdersByIds?` (TikTok Shop only, used as a fallback for orders stuck non-terminal because `update_time_ge` search sometimes misses a changed order).
- Sync is cron-triggered (`src/routes/api/cron/`), constrained by Vercel's 2-crons/day-each cap on this plan — that's why there are two separate cron routes rather than one.
- `nitro.vercel.functionRules` in `vite.config.ts` gives `/api/cron/**` an extended `maxDuration` (800s, the Fluid Compute max) because wide backfills process orders sequentially and can take minutes; don't remove that override without addressing the underlying sequential-processing cost.

### Database (`supabase/migrations/`)

Sequentially numbered SQL migrations (currently 90+), applied in order — this is the source of truth for schema, not `src/types/database.types.ts` (a hand-written mirror kept in sync manually; `src/types/entities.ts` builds domain-friendly types on top of it). RLS is enabled per-table with policies defined at each table's creation migration. Apply new schema changes as a new numbered migration file, never by editing an existing one.

### Routes (`src/routes/`)

File-based routing via `@tanstack/react-router`'s Vite plugin. Adding/renaming/moving a route file requires `npm run generate-routes` (or the dev server, which does it automatically) to regenerate `src/routeTree.gen.ts` — never hand-edit that generated file. `src/routes/admin.tsx` and `src/routes/admin_.login.tsx` gate the `admin/` subtree; `src/routes/api/` holds webhook, OAuth, and cron HTTP endpoints as server routes.

## Environment variables

See `.env.example` for the full annotated list. The `VITE_` prefix is the actual client/server security boundary (Vite only inlines `VITE_*` into the browser bundle) — never add it to a secret. Paired client/server Supabase vars exist deliberately (`VITE_SUPABASE_URL`/`SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`/`SUPABASE_ANON_KEY`); `SUPABASE_SERVICE_ROLE_KEY` has no `VITE_` counterpart and must stay that way.
