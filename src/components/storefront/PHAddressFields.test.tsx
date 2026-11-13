// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PHAddressFields } from './PHAddressFields'
import type { PHAddressValue } from './PHAddressFields'
import { normalizeSearchText } from '#/lib/utils/search-text'

const json = readFileSync('public/data/ph-address.json', 'utf8')

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(JSON.parse(json)) }),
    ),
  )
  Element.prototype.scrollIntoView = vi.fn()
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

/** Open a dropdown by its label, type into its search box, pick an option. */
async function pick(label: string, search: string, option: string) {
  fireEvent.click(await screen.findByRole('combobox', { name: label }))
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: search },
  })
  fireEvent.mouseDown(screen.getByRole('option', { name: option }))
}

describe('normalizeSearchText', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeSearchText('LAS PIÑAS')).toBe('las pinas')
    expect(normalizeSearchText('Calaylayan (Pob.)')).toBe(
      'calaylayan poblacion',
    )
  })
})

describe('PHAddressFields searchable dropdowns', () => {
  it('shows the four dropdowns by default, in order', async () => {
    render(<Harness onValue={() => {}} />)
    expect(await screen.findByRole('combobox', { name: 'Region' })).toBeTruthy()
    expect(
      screen.getByRole('combobox', { name: 'City / Municipality' }),
    ).toHaveProperty('disabled', true)
    expect(screen.getByRole('combobox', { name: 'Barangay' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('filters each list by typing and fills region → barangay', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    await pick('Region', 'central luzon', 'Region III (Central Luzon)')
    await pick('Province', 'bata', 'Bataan')
    await pick('City / Municipality', 'abu', 'Abucay')
    await pick('Barangay', 'bang', 'Bangkal')
    expect(onValue).toHaveBeenLastCalledWith({
      region: 'REGION III (CENTRAL LUZON)',
      province: 'Bataan',
      city: 'Abucay',
      barangay: 'Bangkal',
    })
  })

  it('narrows a long barangay list as you type', async () => {
    render(<Harness onValue={() => {}} />)
    await pick('Region', 'ncr', 'National Capital Region (NCR)')
    await pick('City / Municipality', 'manila', 'City Of Manila')
    fireEvent.click(screen.getByRole('combobox', { name: 'Barangay' }))
    const all = screen.getAllByRole('option').length
    expect(all).toBeGreaterThan(800)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'barangay 105' },
    })
    expect(screen.getAllByRole('option')[0].textContent).toBe('Barangay 105')
    expect(screen.getAllByRole('option').length).toBeLessThan(20)
  })
})
