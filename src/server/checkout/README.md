# server/checkout

Server functions for the checkout flow. Not implemented yet.

When built, this is where the COD-eligibility and risk logic from the
project brief lives:

1. Recompute the cart total server-side from `product_variants.price_cents`
   — the submitted cart is only used to know *which* variants/quantities,
   never their price.
2. Call `reserve_variant_stock()` (see the SQL migration) for every line
   item inside one flow, rolling back reservations if any line fails —
   this is what prevents overselling under concurrent checkouts.
3. Read `customers.successful_orders_count`, `cancelled_orders_count`,
   `failed_delivery_count`, `return_count`, `cod_blocked` to decide whether
   COD is offered, and whether `orders.requires_partial_payment` should be
   set for a risky customer.
4. Create the `orders`/`order_items` rows and call `commit_variant_stock()`
   once payment is confirmed (or immediately for COD, per business rules
   decided later).
5. Insert into `payments` with an `idempotency_key` before calling out to
   any payment provider, so retries can't create duplicate charges/orders.
