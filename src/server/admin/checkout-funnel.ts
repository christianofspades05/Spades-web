/**
 * Reads the step-level checkout funnel reporting views (see
 * supabase/migrations/0127_checkout_funnel_tracking.sql) — both are
 * admin-only (no grant to anon/authenticated), same access model as
 * discounts_with_status.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

export interface CheckoutFunnelDay {
  day: string
  checkoutStart: number
  checkoutView: number
  emailEntered: number
  addressEntered: number
  shippingShown: number
  paymentSelected: number
  placeOrderClicked: number
  orderSuccess: number
  codSelected: number
  onlineSelected: number
}

export interface CheckoutFunnelStep {
  key: keyof Omit<CheckoutFunnelDay, 'day' | 'codSelected' | 'onlineSelected'>
  label: string
  count: number
  /** % of this step's count relative to the step right before it in
   *  STEP_ORDER — null for the first step (checkoutStart has nothing
   *  before it) or when the previous step's count is 0. */
  conversionFromPrevPct: number | null
}

export interface CheckoutFunnelSummary {
  range: { from: string; to: string }
  steps: CheckoutFunnelStep[]
  codSelected: number
  onlineSelected: number
  /** One row per America/Los_Angeles day in range — same step keys as
   *  CheckoutFunnelDay, for a future trend chart; the admin page below
   *  only shows the aggregated `steps` totals for now. */
  daily: CheckoutFunnelDay[]
}

export interface CheckoutShippingDropoffRow {
  region: string | null
  freeShipping: boolean | null
  shippingShownCarts: number
  placeOrderClickedCarts: number
  conversionPct: number | null
}

const STEP_ORDER: {
  key: CheckoutFunnelStep['key']
  label: string
}[] = [
  { key: 'checkoutStart', label: 'Checkout started' },
  { key: 'checkoutView', label: 'Checkout page viewed' },
  { key: 'emailEntered', label: 'Email entered' },
  { key: 'addressEntered', label: 'Address entered' },
  { key: 'shippingShown', label: 'Shipping fee shown' },
  { key: 'paymentSelected', label: 'Payment method selected' },
  { key: 'placeOrderClicked', label: 'Place order clicked' },
  { key: 'orderSuccess', label: 'Order placed/paid' },
]

export const getCheckoutFunnelSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<CheckoutFunnelSummary> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: rows, error } = await admin
      .from('checkout_funnel_daily')
      .select('*')
      .gte('day', data.from)
      .lte('day', data.to)
    if (error) throw error

    const daily: CheckoutFunnelDay[] = rows.map((r) => ({
      day: r.day,
      checkoutStart: r.checkout_start,
      checkoutView: r.checkout_view,
      emailEntered: r.email_entered,
      addressEntered: r.address_entered,
      shippingShown: r.shipping_shown,
      paymentSelected: r.payment_selected,
      placeOrderClicked: r.place_order_clicked,
      orderSuccess: r.order_success,
      codSelected: r.cod_selected,
      onlineSelected: r.online_selected,
    }))

    // Totals across the range, then each step's conversion % is
    // recomputed from those totals rather than averaging the view's own
    // per-day percentages — a day with 0 visitors at a step would
    // otherwise contribute a misleading null/0% with equal weight to a
    // day with hundreds.
    const totals = daily.reduce<Record<CheckoutFunnelStep['key'], number>>(
      (acc, d) => {
        for (const { key } of STEP_ORDER) acc[key] += d[key]
        return acc
      },
      {
        checkoutStart: 0,
        checkoutView: 0,
        emailEntered: 0,
        addressEntered: 0,
        shippingShown: 0,
        paymentSelected: 0,
        placeOrderClicked: 0,
        orderSuccess: 0,
      },
    )
    const codSelected = daily.reduce((sum, d) => sum + d.codSelected, 0)
    const onlineSelected = daily.reduce((sum, d) => sum + d.onlineSelected, 0)

    const steps: CheckoutFunnelStep[] = STEP_ORDER.map(
      ({ key, label }, index) => {
        const count = totals[key]
        const prevCount = index > 0 ? totals[STEP_ORDER[index - 1].key] : null
        return {
          key,
          label,
          count,
          conversionFromPrevPct:
            prevCount === null || prevCount === 0
              ? null
              : Math.round((count / prevCount) * 1000) / 10,
        }
      },
    )

    return { range: data, steps, codSelected, onlineSelected, daily }
  })

export const getCheckoutShippingDropoff = createServerFn({
  method: 'GET',
}).handler(async (): Promise<CheckoutShippingDropoffRow[]> => {
  await requireStaff()
  const admin = getSupabaseAdminClient()
  const { data: rows, error } = await admin
    .from('checkout_shipping_dropoff_by_region')
    .select('*')
  if (error) throw error
  return rows.map((r) => ({
    region: r.region,
    freeShipping: r.free_shipping,
    shippingShownCarts: r.shipping_shown_carts,
    placeOrderClickedCarts: r.place_order_clicked_carts,
    conversionPct: r.conversion_pct,
  }))
})
