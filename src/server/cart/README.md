# server/cart

Server functions for cart mutations (add/update/remove item, merge guest cart
into a signed-in customer's cart on login).

Not implemented yet. When built, these must:

- Look up `product_variants.price_cents` server-side and snapshot it into
  `cart_items.price_cents_snapshot` — never accept a price from the client.
- Re-validate against `inventory.quantity_available` before allowing a
  quantity increase.
- Use `lib/validation/cart.ts` for input validation.
