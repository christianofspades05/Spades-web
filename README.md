# Spades — Ecommerce Platform

Custom ecommerce platform for Spades (Philippine streetwear). Independent
storefront + backend, built to eventually replace the Shopify store.

**Stack:** TanStack Start · React 19 · TypeScript · Tailwind CSS v4 · Supabase
(Postgres, Auth, Storage) · Vercel · GitHub

This repo is currently a **foundation scaffold**, not a finished storefront.
Checkout, payments, marketplace integrations, ShipMate, and ProfitMate are
intentionally not implemented yet — see the `README.md` files inside
`src/server/*` for the design of each before it's built.

---

## Project structure

```
src/
  routes/                 File-based routes (TanStack Router)
    collections/          Storefront collections
    products/              Storefront product listing + detail
    account/                Customer account (placeholder)
    checkout/               Checkout (placeholder)
    admin/                  Staff dashboard (placeholder)
  server/                  Server-only functions (createServerFn), by domain
    products/, collections/  Implemented — public catalog reads
    cart/, checkout/, orders/, customers/, admin/, webhooks/  Design notes only
    integrations/
      marketplaces/tiktok-shop/, marketplaces/shopee/  Design notes only
      shipmate/, profitmate/                            Design notes only
  lib/
    supabase/              client.ts (browser), server.ts (per-request,
                            respects RLS), admin.ts (service role, server-only)
    auth/                  session + guard helpers (requireCustomer, requireStaff)
    validation/            zod schemas for server-function inputs
    utils/                 money (integer cents), order numbers
  types/
    database.types.ts      Hand-written mirror of the Supabase schema
    entities.ts             Domain-friendly types built on top of it
  components/
    storefront/, ui/, account/, checkout/, admin/  By domain

supabase/
  migrations/0001_init_schema.sql   Full schema: tables, RLS, atomic
                                     inventory functions
```

---

## 1. Local setup

```bash
git clone <your-repo-url> spades-web
cd spades-web
npm install
cp .env.example .env   # then fill in real values, see below
npm run dev             # http://localhost:3000
```

## 2. Environment variables

See `.env.example` for the full list with explanations. Summary:

| Variable | Exposed to browser? | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | `src/lib/supabase/client.ts` |
| `VITE_SUPABASE_ANON_KEY` | Yes | `src/lib/supabase/client.ts` |
| `SUPABASE_URL` | No | `src/lib/supabase/server.ts` |
| `SUPABASE_ANON_KEY` | No | `src/lib/supabase/server.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Never** | `src/lib/supabase/admin.ts` |

Vite only inlines variables prefixed `VITE_` into the client bundle — that
prefix is the actual security boundary, not a naming convention. Never add a
`VITE_` prefix to the service role key.

## 3. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy the Project URL, `anon` public key,
   and `service_role` secret key into `.env` (see table above).
3. Apply the schema. Either:
   - **Supabase CLI** (recommended):
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
   - **Or manually**: open the SQL Editor in the Supabase dashboard and run
     the contents of `supabase/migrations/0001_init_schema.sql`.
4. Enable email/password (or your preferred provider) under
   **Authentication → Providers**.
5. Row Level Security is already enabled with policies for every table in
   the migration — no extra dashboard configuration needed for the schema
   itself.

### What's in the schema

20 tables covering customers, addresses, products/variants, collections,
inventory, carts, orders, payments, shipments, returns, discounts, staff
accounts, activity logs, and marketplace sync — plus three Postgres
functions (`reserve_variant_stock`, `release_variant_stock`,
`commit_variant_stock`) that do atomic, conditional stock updates so
concurrent checkouts can never oversell. Full table-by-table rationale is in
the comments at the top of each table in the migration file.

## 4. Development commands

```bash
npm run dev       # start dev server on :3000
npm run build      # production build
npm run preview    # preview a production build locally
npm run test        # run vitest
npm run lint         # eslint
npm run format        # prettier --write + eslint --fix
npm run check          # prettier --check
```

## 5. Deployment (Vercel)

1. Push this repo to GitHub.
2. In Vercel, **Import Project** from the GitHub repo. Vercel auto-detects
   TanStack Start (Vite-based) — no custom build command needed.
3. Add the environment variables from `.env.example` in
   **Project Settings → Environment Variables** (all of them, including the
   server-only and service-role ones — Vercel keeps server env vars out of
   the client bundle the same way local Vite does).
4. Deploy. Every push to `main` redeploys production; PRs get preview
   deployments automatically.

---

## Security notes (read before adding features)

- Product prices and inventory are **only** ever read/written server-side.
  `lib/supabase/admin.ts` (service role) must never be imported into a
  client component — it throws at import time if `window` is defined, as a
  safety net, but don't rely on that; keep it inside `src/server/**`.
- Order totals are computed server-side from `product_variants.price_cents`,
  never accepted from the client.
- Inventory changes must go through `reserve_variant_stock` /
  `commit_variant_stock` / `release_variant_stock` (see the migration) —
  never a plain `UPDATE inventory SET quantity_on_hand = ...` from app code,
  since that reintroduces the race condition those functions exist to
  prevent.
- Webhook handlers (payment provider, TikTok Shop, Shopee, ShipMate) must
  insert into `webhook_events` first and rely on its
  `unique (source, external_event_id)` constraint for idempotency before
  doing any side effects. See `src/server/webhooks/README.md`.
