// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PHAddressFields } from './PHAddressFields'
import type { PHAddressValue } from './PHAddressFields'

const json = readFileSync('public/data/ph-address.json', 'utf8')

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(JSON.parse(json)) }),
    ),
  )
})
afterEach(cleanup)

const EMPTY: PHAddressValue = {
  region: '',
  province: '',
  city: '',
  barangay: '',
}

function Harness({ onValue }: { onValue: (v: PHAddressValue) => void }) {
  const [value, setValue] = useState(EMPTY)
  return (
    <PHAddressFields
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe('PHAddressFields search', () => {
  it('fills region, province, city and barangay from one pick', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const input = await screen.findByPlaceholderText(
      'Type your barangay or city',
    )
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abucay bangkal' } })
    const option = await screen.findByRole('button', {
      name: 'Bangkal, Abucay, Bataan',
    })
    fireEvent.mouseDown(option)

    expect(onValue).toHaveBeenLastCalledWith({
      region: 'REGION III (CENTRAL LUZON)',
      province: 'Bataan',
      city: 'Abucay',
      barangay: 'Bangkal',
    })
    expect(screen.getByText('Bangkal, Abucay, Bataan')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy()
  })

  it('asks for the barangay after a city-only pick', async () => {
    render(<Harness onValue={() => {}} />)
    const input = await screen.findByPlaceholderText(
      'Type your barangay or city',
    )
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'abucay' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const select = await screen.findByRole('combobox', { name: 'Barangay' })
    expect(select).toBeTruthy()
  })

  it('keeps the dropdowns as a fallback', async () => {
    render(<Harness onValue={() => {}} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose from lists instead' }),
    )
    expect(screen.getByRole('combobox', { name: 'Region' })).toBeTruthy()
  })
})
