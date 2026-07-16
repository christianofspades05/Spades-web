interface OrderItemLike {
  product_name_snapshot: string
  variant_label_snapshot: string | null
}

/**
 * "product title - SIZE" per line, for pasting into courier booking forms.
 * variant_label_snapshot is "size / color / style" (see place-order.ts), and
 * size — when present — is always the first segment, so it's safe to pull
 * out without needing a separate size column on order_items.
 */
export function formatOrderItemsForCopy(items: OrderItemLike[]): string {
  return items
    .map((item) => {
      const size = item.variant_label_snapshot?.split(' / ')[0]
      return size
        ? `${item.product_name_snapshot} - ${size.toUpperCase()}`
        : item.product_name_snapshot
    })
    .join('\n')
}
