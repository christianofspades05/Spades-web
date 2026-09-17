import { createFileRoute, redirect } from '@tanstack/react-router'
import { reorderFromOrder } from '#/server/cart/reorder'

/** Landed on from the failed-delivery email's "Order again" link — rebuilds
 *  a cart from that order's items, then sends the customer straight to
 *  /cart with everything already in it (see reorderFromOrder). */
export const Route = createFileRoute('/reorder/$orderId')({
  beforeLoad: async ({ params }) => {
    await reorderFromOrder({ data: { orderId: params.orderId } })
    throw redirect({ to: '/cart' })
  },
})
