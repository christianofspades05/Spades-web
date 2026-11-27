// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DateRangePicker } from './DateRangePicker'

afterEach(cleanup)

function open(onChange = vi.fn()) {
  render(
    <DateRangePicker
      preset="this_month"
      from="2026-11-01"
      to="2026-11-13"
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /2026/ }))
  return onChange
}

describe('DateRangePicker custom range', () => {
  it('picks a range with two clicks in one calendar, then Apply', () => {
    const onChange = open()
    expect(screen.getByText('November 2026')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Nov 12, 2026' }))
    expect(screen.getByText('Nov 12, 2026 – pick the last day')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Nov 25, 2026' }))
    expect(screen.getByText('Nov 12, 2026 – Nov 25, 2026')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith('custom', {
      from: '2026-11-12',
      to: '2026-11-25',
    })
  })

  it('can span months using the arrows', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('October 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Oct 20, 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nov 5, 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith('custom', {
      from: '2026-10-20',
      to: '2026-11-05',
    })
  })

  it('applies a single day when only the start is picked', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('button', { name: 'Nov 3, 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith('custom', {
      from: '2026-11-03',
      to: '2026-11-03',
    })
  })

  it('still offers the presets', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    expect(onChange).toHaveBeenCalledWith('last_7_days')
  })
})

describe('DateRangePicker double-digit sales', () => {
  afterEach(() => vi.useRealTimers())

  it('applies a sale day for the chosen year and disables future ones', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-27T04:00:00Z'))
    const onChange = open()

    for (let m = 1; m <= 12; m++) {
      expect(screen.getByRole('button', { name: `${m}.${m}` })).toBeTruthy()
    }
    const dec = screen.getByRole('button', { name: '12.12' })
    expect((dec as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '11.11' }))
    expect(onChange).toHaveBeenLastCalledWith('custom', {
      from: '2026-11-11',
      to: '2026-11-11',
    })
  })

  it('switches year from the dropdown', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-27T04:00:00Z'))
    const onChange = open()
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Double-digit sale year' }),
      { target: { value: '2025' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '12.12' }))
    expect(onChange).toHaveBeenLastCalledWith('custom', {
      from: '2025-12-12',
      to: '2025-12-12',
    })
  })
})
