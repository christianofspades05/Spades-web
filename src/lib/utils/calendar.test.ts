import { describe, expect, it } from 'vitest'
import {
  addMonths,
  monthGrid,
  monthLabel,
  monthOf,
  nextRangeSelection,
} from './calendar'

describe('monthGrid', () => {
  it('pads so the 1st lands on its weekday (Nov 2026 starts on a Sunday)', () => {
    const grid = monthGrid({ year: 2026, month: 10 })
    expect(grid[0]).toBe('2026-11-01')
    expect(grid.filter(Boolean)).toHaveLength(30)
  })

  it('handles leap years and leading blanks', () => {
    const grid = monthGrid({ year: 2028, month: 1 }) // Feb 2028, starts Tue
    expect(grid.slice(0, 2)).toEqual([null, null])
    expect(grid.at(-1)).toBe('2028-02-29')
  })
})

describe('month navigation', () => {
  it('crosses year boundaries', () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({
      year: 2027,
      month: 0,
    })
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({
      year: 2025,
      month: 11,
    })
    expect(monthOf('2026-11-13')).toEqual({ year: 2026, month: 10 })
    expect(monthLabel({ year: 2026, month: 10 })).toBe('November 2026')
  })
})

describe('nextRangeSelection', () => {
  it('first click sets the start, second click sets the end', () => {
    const start = nextRangeSelection({ from: null, to: null }, '2026-11-12')
    expect(start).toEqual({ from: '2026-11-12', to: null })
    expect(nextRangeSelection(start, '2026-11-25')).toEqual({
      from: '2026-11-12',
      to: '2026-11-25',
    })
  })

  it('a second click before the start moves the start', () => {
    expect(
      nextRangeSelection({ from: '2026-11-12', to: null }, '2026-11-03'),
    ).toEqual({ from: '2026-11-03', to: null })
  })

  it('clicking the start again makes a one-day range', () => {
    expect(
      nextRangeSelection({ from: '2026-11-12', to: null }, '2026-11-12'),
    ).toEqual({ from: '2026-11-12', to: '2026-11-12' })
  })

  it('a click after a complete range starts a new one', () => {
    expect(
      nextRangeSelection(
        { from: '2026-11-01', to: '2026-11-13' },
        '2026-10-05',
      ),
    ).toEqual({ from: '2026-10-05', to: null })
  })
})
