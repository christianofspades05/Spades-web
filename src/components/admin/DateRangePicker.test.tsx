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
