import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  marketInputSchema,
  updateMarketSchema,
} from '#/lib/validation/admin/market-pricing'
import type { MarketInput } from '#/lib/validation/admin/market-pricing'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { MarketWithCountries, StaffRole } from '#/types/entities'

// Not `as const` — requireStaff expects a plain mutable StaffRole[].
const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

/** market_countries.country_code is globally unique (a country can only
 *  belong to one market) — Postgres surfaces that as a generic 23505 unique-
 *  violation, which reads as a confusing raw error otherwise. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  )
}

/** Shared insert/update row shape for markets' non-country columns. */
function toMarketRow(data: MarketInput) {
  return {
    markup_percent: data.markupPercent,
    is_active: data.isActive,
    shipping_name: data.shippingName ?? null,
    shipping_price_cents: data.shippingPriceCents ?? null,
    shipping_currency: data.shippingCurrency,
    free_shipping_min_subtotal_cents: data.freeShippingMinSubtotalCents ?? null,
    free_shipping_min_items: data.freeShippingMinItems ?? null,
  }
}

export const listMarkets = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketWithCountries[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('markets')
      .select('*, market_countries(country_code)')
      .order('created_at', { ascending: true })
    if (error) throw error
    return data.map((m) => ({
      id: m.id,
      markup_percent: m.markup_percent,
      is_active: m.is_active,
      shipping_name: m.shipping_name,
      shipping_price_cents: m.shipping_price_cents,
      shipping_currency: m.shipping_currency,
      free_shipping_min_subtotal_cents: m.free_shipping_min_subtotal_cents,
      free_shipping_min_items: m.free_shipping_min_items,
      created_at: m.created_at,
      updated_at: m.updated_at,
      countryCodes: m.market_countries
        .map((c) => c.country_code)
        .sort((a, b) => a.localeCompare(b)),
    }))
  },
)

export const getMarketById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<MarketWithCountries | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: market, error } = await admin
      .from('markets')
      .select('*, market_countries(country_code)')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    if (!market) return null
    return {
      id: market.id,
      markup_percent: market.markup_percent,
      is_active: market.is_active,
      shipping_name: market.shipping_name,
      shipping_price_cents: market.shipping_price_cents,
      shipping_currency: market.shipping_currency,
      free_shipping_min_subtotal_cents: market.free_shipping_min_subtotal_cents,
      free_shipping_min_items: market.free_shipping_min_items,
      created_at: market.created_at,
      updated_at: market.updated_at,
      countryCodes: market.market_countries
        .map((c) => c.country_code)
        .sort((a, b) => a.localeCompare(b)),
    }
  })

export const createMarket = createServerFn({ method: 'POST' })
  .validator(marketInputSchema)
  .handler(async ({ data }): Promise<MarketWithCountries> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: market, error: marketError } = await admin
      .from('markets')
      .insert(toMarketRow(data))
      .select('*')
      .single()
    if (marketError) throw marketError

    const { error: countriesError } = await admin
      .from('market_countries')
      .insert(
        data.countryCodes.map((countryCode) => ({
          market_id: market.id,
          country_code: countryCode,
        })),
      )
    if (countriesError) {
      // Roll back the bare market row rather than leaving an orphaned,
      // country-less market behind — createMarket should be all-or-nothing.
      await admin.from('markets').delete().eq('id', market.id)
      if (isUniqueViolation(countriesError)) {
        throw new Error(
          'One or more of these countries already belong to another market.',
        )
      }
      throw countriesError
    }

    await logStaffActivity(staff, 'market.create', 'markets', market.id, {
      countryCodes: data.countryCodes,
      markupPercent: data.markupPercent,
    })
    return { ...market, countryCodes: data.countryCodes }
  })

export const updateMarket = createServerFn({ method: 'POST' })
  .validator(updateMarketSchema)
  .handler(async ({ data }): Promise<MarketWithCountries> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: market, error: marketError } = await admin
      .from('markets')
      .update({ ...toMarketRow(data), updated_at: new Date().toISOString() })
      .eq('id', data.id)
      .select('*')
      .single()
    if (marketError) throw marketError

    // Replace membership wholesale rather than diffing add/remove — with at
    // most a handful of countries per market, deleting and re-inserting the
    // full set is simpler than reconciling two arrays and just as cheap.
    const { error: deleteError } = await admin
      .from('market_countries')
      .delete()
      .eq('market_id', data.id)
    if (deleteError) throw deleteError

    const { error: insertError } = await admin.from('market_countries').insert(
      data.countryCodes.map((countryCode) => ({
        market_id: data.id,
        country_code: countryCode,
      })),
    )
    if (insertError) {
      if (isUniqueViolation(insertError)) {
        throw new Error(
          'One or more of these countries already belong to another market.',
        )
      }
      throw insertError
    }

    await logStaffActivity(staff, 'market.update', 'markets', market.id, {
      countryCodes: data.countryCodes,
    })
    return { ...market, countryCodes: data.countryCodes }
  })
