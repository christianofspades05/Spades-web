import { describe, expect, it } from 'vitest'
import { shippingCostCents } from './shipping'

describe('shippingCostCents', () => {
  const belowFreeShipping = 100_000

  it('charges the Metro Manila rate for NCR', () => {
    expect(
      shippingCostCents(
        'PH',
        'NATIONAL CAPITAL REGION (NCR)',
        '',
        belowFreeShipping,
        1,
        {},
      ),
    ).toBe(6_000)
  })

  it('charges the Luzon rate for a region III province with no override', () => {
    expect(
      shippingCostCents(
        'PH',
        'REGION III (CENTRAL LUZON)',
        'PAMPANGA',
        belowFreeShipping,
        1,
        {},
      ),
    ).toBe(6_000)
  })

  it('charges the Visayas rate', () => {
    expect(
      shippingCostCents(
        'PH',
        'REGION VII (CENTRAL VISAYAS)',
        'CEBU',
        belowFreeShipping,
        1,
        {},
      ),
    ).toBe(7_500)
  })

  it('charges the Mindanao rate', () => {
    expect(
      shippingCostCents(
        'PH',
        'REGION XI (DAVAO REGION)',
        'DAVAO DEL SUR',
        belowFreeShipping,
        1,
        {},
      ),
    ).toBe(8_000)
  })

  it.each([
    ['Mountain Province', 9_000],
    ['mountain province', 9_000],
    ['Romblon', 9_000],
    ['Palawan', 7_500],
  ])(
    'overrides the zone rate for %s regardless of its region',
    (province, expectedCents) => {
      // Both are nominally in the "luzon" zone (MIMAROPA/CAR) per
      // shippingZoneForRegion, whose base rate (6_000) the override must
      // win over.
      expect(
        shippingCostCents(
          'PH',
          'MIMAROPA REGION',
          province,
          belowFreeShipping,
          1,
          {},
        ),
      ).toBe(expectedCents)
    },
  )

  it('still waives shipping above the free-shipping threshold, even for an override province', () => {
    expect(
      shippingCostCents('PH', 'MIMAROPA REGION', 'Palawan', 200_000, 1, {}),
    ).toBe(0)
  })

  it('charges the normal rate below the threshold regardless of payment method', () => {
    expect(
      shippingCostCents(
        'PH',
        'NATIONAL CAPITAL REGION (NCR)',
        '',
        belowFreeShipping,
        1,
        {},
        undefined,
        false,
      ),
    ).toBe(6_000)
  })
})
