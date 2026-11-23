import { describe, expect, it } from 'vitest'
import {
  createCommunityFitSchema,
  normalizeInstagramHandle,
  normalizeInstagramPostUrl,
} from './community-fits'

describe('normalizeInstagramPostUrl', () => {
  it('accepts post and reel links and canonicalizes them', () => {
    expect(
      normalizeInstagramPostUrl(
        'https://www.instagram.com/p/DAbc_12-x/?igsh=xyz',
      ),
    ).toBe('https://www.instagram.com/p/DAbc_12-x/')
    expect(normalizeInstagramPostUrl('instagram.com/p/ABC')).toBeNull()
    expect(normalizeInstagramPostUrl('https://instagram.com/reels/XYZ')).toBe(
      'https://www.instagram.com/reel/XYZ/',
    )
    expect(
      normalizeInstagramPostUrl(
        'https://www.instagram.com/some.user/p/ABC123/',
      ),
    ).toBe('https://www.instagram.com/p/ABC123/')
  })

  it('rejects non-post and non-instagram links', () => {
    expect(
      normalizeInstagramPostUrl('https://www.instagram.com/spades/'),
    ).toBeNull()
    expect(
      normalizeInstagramPostUrl('https://www.instagram.com/stories/a/1'),
    ).toBeNull()
    expect(normalizeInstagramPostUrl('https://evil.com/p/ABC/')).toBeNull()
    expect(
      normalizeInstagramPostUrl('https://instagram.com.evil.com/p/ABC/'),
    ).toBeNull()
    expect(normalizeInstagramPostUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeInstagramPostUrl('not a url')).toBeNull()
  })
})

describe('normalizeInstagramHandle', () => {
  it('strips @ and profile URLs', () => {
    expect(normalizeInstagramHandle('@Raffy_Carps')).toBe('raffy_carps')
    expect(normalizeInstagramHandle(' _lowjell ')).toBe('_lowjell')
    expect(
      normalizeInstagramHandle('https://www.instagram.com/some.user/'),
    ).toBe('some.user')
  })
})

describe('createCommunityFitSchema', () => {
  it('rejects a bad link and a bad handle', () => {
    const result = createCommunityFitSchema.safeParse({
      instagramUrl: 'https://tiktok.com/@x',
      handle: 'has spaces',
      imageUrl: 'https://example.com/a.jpg',
    })
    expect(result.success).toBe(false)
  })

  it('normalizes valid input', () => {
    const result = createCommunityFitSchema.parse({
      instagramUrl: 'https://www.instagram.com/reel/ABC/?utm_source=ig',
      handle: '@Lowjell',
      imageUrl: 'https://example.com/a.jpg',
    })
    expect(result).toEqual({
      instagramUrl: 'https://www.instagram.com/reel/ABC/',
      handle: 'lowjell',
      imageUrl: 'https://example.com/a.jpg',
    })
  })
})
