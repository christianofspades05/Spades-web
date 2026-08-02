-- Holds an online-payment checkout's stock reservation + order snapshot
-- while the customer is on Xendit's hosted payment page. Deliberately NOT
-- the `orders` table: a real order (with a customer-facing order number)
-- only gets created once Xendit confirms PAID (see api/webhooks/xendit.ts).
-- If the customer abandons or fails payment, this row is just deleted —
-- no order number ever gets consumed and nothing shows up in the admin
-- orders list. COD checkouts skip this table entirely; they're a real,
-- confirmed order the moment they're placed.
create table checkout_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete restrict,
  cart_id uuid not null references carts (id) on delete restrict,
  brand text not null,
  currency text not null,
  subtotal_cents integer not null,
  discount_cents integer not null,
  shipping_cents integer not null,
  total_cents integer not null,
  discount_id uuid references discounts (id) on delete set null,
  market_markup_percent numeric,
  shipping_address jsonb not null,
  -- order_items-shaped snapshot: { variantId, productNameSnapshot,
  -- variantLabelSnapshot, skuSnapshot, unitPriceCents, quantity,
  -- lineSubtotalCents, lineDiscountCents, lineTotalCents }[] — copied
  -- directly into real order_items rows once the order is minted.
  items jsonb not null,
  xendit_invoice_id text,
  created_at timestamptz not null default now()
);

create unique index checkout_reservations_xendit_invoice_id_key
  on checkout_reservations (xendit_invoice_id)
  where xendit_invoice_id is not null;

-- Sweeping stale reservations on the 15-min cron backstop.
create index checkout_reservations_created_at_idx
  on checkout_reservations (created_at);

alter table checkout_reservations enable row level security;
-- No client-facing policies, deliberately — only ever read/written via the
-- service-role admin client (place-order.ts, the Xendit webhook, and the
-- expiry cron), same convention already used for e.g. `inventory`.
