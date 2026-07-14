/**
 * Human-readable order numbers (e.g. SPD-20260714-4F2A). Uniqueness is
 * still enforced by the `orders.order_number` UNIQUE constraint — this is
 * just a nicer identifier than the raw UUID, not the concurrency guard.
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
  const randomPart = crypto.randomUUID().split('-')[0].slice(0, 4).toUpperCase()
  return `SPD-${datePart}-${randomPart}`
}
