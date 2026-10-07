import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { previousPeriod } from './date-range'

// Pinned so "today" inside previousPeriod() (which reads real current time)
// is deterministic — 2026-10-06, a Tuesday, matching the live scenario this
// whole set of rules was confirmed against. Set as UTC midnight *minus* the
// store's +8 offset so storeNow()'s own shift lands exactly on 2026-10-06
// 00:00 store-local, not a few hours into 2026-10-05 or -07.
const PINNED_NOW = new Date('2026-10-05T16:00:00.000Z')

describe('previousPeriod', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(PINNED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Today compares to the day before it (not a month back)', () => {
    expect(previousPeriod('2026-10-06', '2026-10-06')).toEqual({
      from: '2026-10-05',
      to: '2026-10-05',
    })
  })

  it('a single day other than today also compares to the day before it', () => {
    expect(previousPeriod('2026-10-05', '2026-10-05')).toEqual({
      from: '2026-10-04',
      to: '2026-10-04',
    })
  })

  it('a single day rolls back across a month boundary', () => {
    expect(previousPeriod('2026-10-01', '2026-10-01')).toEqual({
      from: '2026-09-30',
      to: '2026-09-30',
    })
  })

  it('a single day rolls back across a year boundary', () => {
    expect(previousPeriod('2026-01-01', '2026-01-01')).toEqual({
      from: '2025-12-31',
      to: '2025-12-31',
    })
  })

  it('Last 7 Days compares to the immediately preceding 7 days', () => {
    // Last 7 Days, today pinned to 2026-10-06: 2026-09-30 .. 2026-10-06.
    expect(previousPeriod('2026-09-30', '2026-10-06')).toEqual({
      from: '2026-09-23',
      to: '2026-09-29',
    })
  })

  it('Last 30 Days compares to the immediately preceding 30 days', () => {
    // Last 30 Days, today pinned to 2026-10-06: 2026-09-07 .. 2026-10-06.
    expect(previousPeriod('2026-09-07', '2026-10-06')).toEqual({
      from: '2026-08-08',
      to: '2026-09-06',
    })
  })

  it('Last 90 Days compares to the immediately preceding 90 days', () => {
    // Last 90 Days, today pinned to 2026-10-06: 2026-07-09 .. 2026-10-06.
    expect(previousPeriod('2026-07-09', '2026-10-06')).toEqual({
      from: '2026-04-10',
      to: '2026-07-08',
    })
  })

  it('This Month (month-to-date) compares to the whole of Last Month', () => {
    // This Month, today pinned to 2026-10-06: 2026-10-01 .. 2026-10-06.
    expect(previousPeriod('2026-10-01', '2026-10-06')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })

  it('Last Month (a complete past month) compares to the month before that', () => {
    expect(previousPeriod('2026-09-01', '2026-09-30')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    })
  })

  it('a complete past month with fewer days still compares correctly (Feb)', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('a custom range compares to the same calendar dates one month earlier', () => {
    // Not shaped like Last 7/30/90 Days, This Month, or a complete month —
    // e.g. a staff member picking Oct 3-5 by hand.
    expect(previousPeriod('2026-10-03', '2026-10-05')).toEqual({
      from: '2026-09-03',
      to: '2026-09-05',
    })
  })

  it('clamps a custom range ending on the 31st back to the shorter target month', () => {
    expect(previousPeriod('2026-10-30', '2026-10-31')).toEqual({
      from: '2026-09-30',
      to: '2026-09-30',
    })
  })

  it('clamps a custom range ending March 31 back to Feb 28 in a non-leap year', () => {
    expect(previousPeriod('2026-03-30', '2026-03-31')).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    })
  })

  it('clamps a custom range ending March 31 back to Feb 29 in a leap year', () => {
    expect(previousPeriod('2028-03-30', '2028-03-31')).toEqual({
      from: '2028-02-29',
      to: '2028-02-29',
    })
  })

  it('rolls a custom range over into the previous year from January', () => {
    expect(previousPeriod('2026-01-15', '2026-01-20')).toEqual({
      from: '2025-12-15',
      to: '2025-12-20',
    })
  })
})
