/**
 * Guest event registration — no account required, matching the guest
 * cart/checkout flow's trust model (see server/checkout/place-order.ts):
 * identify the registrant purely from validated input, never from auth.
 * Slot capacity is enforced atomically server-side by the
 * reserve_event_slot RPC (see 0106_community_events.sql) — the client
 * never supplies a fee or a slot count, only who's registering.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getStorefrontScope } from '#/server/storefront/domain'
import { registerForEventSchema } from '#/lib/validation/events'
import { createXenditInvoice } from '#/lib/xendit/client'
import { centsToPesos } from '#/lib/utils/money'

export const registerForEvent = createServerFn({ method: 'POST' })
  .validator(registerForEventSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      confirmed: boolean
      registrationId: string
      invoiceUrl: string | null
    }> => {
      // Defense in depth — the storefront route itself already 404s for
      // Ysrael/Aspire365 (Events is Spades-only), but a request straight
      // to this server fn (bypassing the route) should still be rejected.
      const scope = await getStorefrontScope()
      if (scope.brand !== 'spades') {
        throw new Error('Events are only available on the Spades storefront.')
      }

      const admin = getSupabaseAdminClient()

      const { data: registration, error } = await admin.rpc(
        'reserve_event_slot',
        {
          p_event_id: data.eventId,
          p_full_name: data.fullName,
          p_age: data.age,
          p_email: data.email,
          p_phone: data.phone || null,
        },
      )
      if (error) throw error

      const { data: event, error: eventError } = await admin
        .from('community_events')
        .select('name, slug')
        .eq('id', registration.event_id)
        .single()
      if (eventError) throw eventError

      if (registration.fee_cents === 0) {
        // Already 'confirmed' by reserve_event_slot for a free event —
        // reuses the shared mint path only to send the confirmation
        // email, rather than duplicating that send here.
        const { mintEventRegistration } = await import('./mint-registration')
        await mintEventRegistration(admin, registration.id)
        return {
          confirmed: true,
          registrationId: registration.id,
          invoiceUrl: null,
        }
      }

      const origin = getRequestUrl().origin
      const invoice = await createXenditInvoice({
        externalId: registration.id,
        amount: centsToPesos(registration.fee_cents),
        currency: 'PHP',
        payerEmail: data.email,
        description: `${event.name} registration`,
        successRedirectUrl: `${origin}/events/${event.slug}?registered=${registration.id}`,
        failureRedirectUrl: `${origin}/events/${event.slug}?paymentFailed=true`,
        // Same 5-minute window checkout uses (place-order.ts) — the
        // stale-registration sweep in api/cron/expire-unpaid-orders.ts
        // uses the same 15-minute cutoff that invoice duration is sized
        // against there, reused as-is for events too.
        invoiceDuration: 300,
      })

      await admin
        .from('event_registrations')
        .update({ xendit_invoice_id: invoice.id })
        .eq('id', registration.id)

      return {
        confirmed: false,
        registrationId: registration.id,
        invoiceUrl: invoice.invoice_url,
      }
    },
  )
