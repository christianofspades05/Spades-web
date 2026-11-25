import { describe, expect, it } from 'vitest'
import { manilaDateKey, seededShuffle } from './daily-shuffle'

describe('seededShuffle', () => {
  const items = Array.from({ length: 20 }, (_, i) => i)

  it('is stable for the same seed', () => {
    expect(seededShuffle(items, '2026-11-25')).toEqual(
      seededShuffle(items, '2026-11-25'),
    )
  })

  it('changes order for a different day and keeps every item', () => {
    const a = seededShuffle(items, '2026-11-25')
    const b = seededShuffle(items, '2026-11-26')
    expect(a).not.toEqual(b)
    expect([...b].sort((x, y) => x - y)).toEqual(items)
  })

  it('does not mutate the input', () => {
    const copy = [...items]
    seededShuffle(items, 'x')
    expect(items).toEqual(copy)
  })
})

describe('manilaDateKey', () => {
  it('rolls over at Manila midnight (UTC+8)', () => {
    expect(manilaDateKey(new Date('2026-11-25T15:59:00Z'))).toBe('2026-11-25')
    expect(manilaDateKey(new Date('2026-11-25T16:00:00Z'))).toBe('2026-11-26')
  })
})
