/**
 * Shared by every "this checkout didn't happen" path (Xendit EXPIRED/FAILED,
 * the stale-reservation cron backstop, PayPal DENIED/cancelled) — gives back
 * the reserved stock and marks the reservation released.
 *
 * Deliberately soft-delete (released_at), not a real delete: confirmed live
 * more than once that a payment provider's own "this expired/failed" status
 * can still be wrong — its PAID confirmation lagging the actual payment, or
 * (seen 2026-09-15) a payment rail completing a transfer minutes after the
 * provider's own invoice had already expired on both sides. A hard delete
 * here means a legitimately-late PAID webhook has nothing left to mint an
 * order from and silently fails — which is exactly what happened four times
 * in production before this fix. Keeping the row lets mint_checkout_order
 * recover it later exactly as if it were still active; mint_checkout_order
 * is what actually deletes the row, once an order has been created from it.
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type {
  CheckoutReservationItem,
  Database,
} from '#/types/database.types'

export async function releaseReservationStock(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  reservation: Database['public']['Tables']['checkout_reservations']['Row'],
): Promise<void> {
  await Promise.all(
    reservation.items
      .filter(
        (item): item is CheckoutReservationItem & { variantId: string } =>
          item.variantId !== null,
      )
      .map((item) =>
        admin.rpc('release_variant_stock', {
          p_variant_id: item.variantId,
          p_quantity: item.quantity,
        }),
      ),
  )
  await admin
    .from('checkout_reservations')
    .update({ released_at: new Date().toISOString() })
    .eq('id', reservation.id)
}
