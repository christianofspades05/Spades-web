import { describe, expect, it } from 'vitest'
import { commissionRateLabel } from './commission-label'

describe('commissionRateLabel', () => {
  it('shows the normal rate for older orders without a breakdown', () => {
    expect(
      commissionRateLabel({ commission_bps: 500, rate_breakdown: [] }),
    ).toBe('5% commission')
  })

  it('labels an all-sale order', () => {
    expect(
      commissionRateLabel({
        commission_bps: 500,
        rate_breakdown: [{ rate_bps: 200, revenue_cents: 78903 }],
      }),
    ).toBe('Sale-day commission 2%')
  })

  it('labels a mixed order', () => {
    expect(
      commissionRateLabel({
        commission_bps: 500,
        rate_breakdown: [
          { rate_bps: 500, revenue_cents: 89640 },
          { rate_bps: 200, revenue_cents: 78903 },
        ],
      }),
    ).toBe('5% + 2% sale-day commission')
  })
})
