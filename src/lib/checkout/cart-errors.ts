/**
 * The distinct reasons place-order can't find a cart to check out, each with
 * its own customer-facing message. Before Nov 2026 all four surfaced as the
 * same "Your cart is empty", so checkout_order_error events couldn't tell
 * them apart. Shared by the server (which throws the message) and the
 * checkout page (which maps it back to a `reason` for tracking) because a
 * server function's thrown Error only reliably carries its message to the
 * client, not custom properties.
 *
 * In the Nov 9-13 data, 10 of 11 affected carts were `cart_already_ordered`:
 * the first Place Order had succeeded, and the shopper came back to a
 * checkout page still showing the old items and tapped Place Order again.
 */
export const CART_ERROR_MESSAGES = {
  /** No cart cookie on the request at all. */
  no_cart_token: "We couldn't find your cart. Please add your items again.",
  /** The cart behind this cookie already became an order. */
  cart_already_ordered:
    'This order has already been placed. Check your email for the confirmation, or add items to start a new order.',
  /** The cart exists but is no longer active for another reason (e.g. abandoned/expired). */
  cart_not_active: 'Your cart has expired. Please add your items again.',
  /** Active cart, but it has no items. */
  cart_no_items: 'Your cart is empty',
  /** The cart's code expired (or ran out of uses) while the shopper was on
   *  checkout, so it was just removed and the total changed. Normally a
   *  stale code is dropped quietly when the cart loads; this only happens
   *  if it lapses between the checkout page loading and Place Order. */
  discount_removed:
    'Your discount code has expired, so we removed it. Please check your new total and place your order again.',
} as const

export type CartErrorReason = keyof typeof CART_ERROR_MESSAGES

export function cartErrorReasonOf(message: string): CartErrorReason | null {
  for (const [reason, text] of Object.entries(CART_ERROR_MESSAGES)) {
    if (message === text) return reason as CartErrorReason
  }
  return null
}
