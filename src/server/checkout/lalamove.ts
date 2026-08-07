/**
 * Customer-facing Lalamove fee estimate, shown at checkout while picking
 * the delivery pin. This is informational only — place-order.ts always
 * fetches its own fresh quotation at order-placement time rather than
 * trusting anything computed here, since a quotation is only valid for 5
 * minutes and the customer may spend longer than that finishing checkout.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getLalamoveQuotation } from '#/lib/lalamove/client'
import { isLalamoveAvailableToday } from '#/lib/checkout/lalamove-eligibility'
import { getStorefrontScope } from '#/server/storefront/domain'

export const getLalamoveEstimate = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      dropoffLat: z.number(),
      dropoffLng: z.number(),
      dropoffAddress: z.string().min(1),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ estimatedFeeCents: number; currency: string }> => {
      const scope = await getStorefrontScope()
      if (scope.brand !== 'spades') {
        throw new Error('Lalamove delivery is only available on Spades.')
      }
      if (!isLalamoveAvailableToday()) {
        throw new Error('Lalamove delivery is not available on Sundays.')
      }

      const quotation = await getLalamoveQuotation({
        dropoffLat: data.dropoffLat,
        dropoffLng: data.dropoffLng,
        dropoffAddress: data.dropoffAddress,
      })

      return {
        estimatedFeeCents: quotation.feeCents,
        currency: quotation.currency,
      }
    },
  )
