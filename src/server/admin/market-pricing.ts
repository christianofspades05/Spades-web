import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  marketPricingInputSchema,
  setMarketPricingActiveSchema,
  updateMarketPricingSchema,
} from '#/lib/validation/admin/market-pricing'
import type { MarketPricingInput } from '#/lib/validation/admin/market-pricing'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { MarketPricing, StaffRole } from '#/types/entities'

// Not `as const` — requireStaff expects a plain mutable StaffRole[].
const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

function toRow(data: MarketPricingInput) {
  return {
    country_code: data.countryCode,
    markup_percent: data.markupPercent,
    is_active: data.isActive,
  }
}

export const listMarketPricing = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketPricing[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('market_pricing')
      .select('*')
      .order('country_code', { ascending: true })
    if (error) throw error
    return data
  },
)

export const getMarketPricingById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<MarketPricing | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: market, error } = await admin
      .from('market_pricing')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    return market
  })

export const createMarketPricing = createServerFn({ method: 'POST' })
  .validator(marketPricingInputSchema)
  .handler(async ({ data }): Promise<MarketPricing> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: market, error } = await admin
      .from('market_pricing')
      .insert(toRow(data))
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'market_pricing.create',
      'market_pricing',
      market.id,
      { countryCode: data.countryCode, markupPercent: data.markupPercent },
    )
    return market
  })

export const updateMarketPricing = createServerFn({ method: 'POST' })
  .validator(updateMarketPricingSchema)
  .handler(async ({ data }): Promise<MarketPricing> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: market, error } = await admin
      .from('market_pricing')
      .update(toRow(data))
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'market_pricing.update',
      'market_pricing',
      market.id,
      {},
    )
    return market
  })

export const setMarketPricingActive = createServerFn({ method: 'POST' })
  .validator(setMarketPricingActiveSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('market_pricing')
      .update({ is_active: data.isActive })
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'market_pricing.set_active',
      'market_pricing',
      data.id,
      { isActive: data.isActive },
    )
  })
