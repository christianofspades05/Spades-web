import { describe, it, expect } from 'vitest'
import { previousPeriod } from './date-range'

describe('previousPeriod', () => {
  it('shifts a mid-month range back one calendar month, same dates', () => {
    expect(previousPeriod('2026-10-01', '2026-10-06')).toEqual({
      from: '2026-09-01',
      to: '2026-09-06',
    })
  })

  it('shifts a single day back one calendar month', () => {
    expect(previousPeriod('2026-10-05', '2026-10-05')).toEqual({
      from: '2026-09-05',
      to: '2026-09-05',
    })
  })

  it('clamps to the last day of the target month when it has fewer days (Oct 31 -> Sep 30)', () => {
    expect(previousPeriod('2026-10-31', '2026-10-31')).toEqual({
      from: '2026-09-30',
      to: '2026-09-30',
    })
  })

  it('clamps a full-month range spanning a shorter target month (Oct 1-31 -> Sep 1-30)', () => {
    expect(previousPeriod('2026-10-01', '2026-10-31')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })

  it('rolls over into the previous year from January', () => {
    expect(previousPeriod('2026-01-15', '2026-01-20')).toEqual({
      from: '2025-12-15',
      to: '2025-12-20',
    })
  })

  it('clamps March 31 back to the last day of February in a non-leap year', () => {
    expect(previousPeriod('2026-03-31', '2026-03-31')).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    })
  })

  it('clamps March 31 back to Feb 29 in a leap year', () => {
    expect(previousPeriod('2028-03-31', '2028-03-31')).toEqual({
      from: '2028-02-29',
      to: '2028-02-29',
    })
  })
})
