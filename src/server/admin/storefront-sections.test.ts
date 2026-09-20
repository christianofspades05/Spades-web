import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSupabaseAdminClient } = vi.hoisted(() => ({
  mockGetSupabaseAdminClient: vi.fn(),
}))
vi.mock('#/lib/supabase/admin', () => ({
  getSupabaseAdminClient: mockGetSupabaseAdminClient,
}))

const { mockInvalidate } = vi.hoisted(() => ({
  mockInvalidate: vi.fn(async () => undefined),
}))
vi.mock('#/server/storefront/sections', () => ({
  invalidateStorefrontSectionsCache: mockInvalidate,
}))

const FAKE_STAFF = { id: 'staff-1', role: 'admin' } as never

/** Fake admin client covering storefront_sections CRUD plus the
 *  activity_logs insert every mutation also performs (logStaffActivity
 *  shares the same getSupabaseAdminClient()). */
function fakeAdmin(sectionsById: Map<string, Record<string, unknown>>) {
  return {
    from(table: string) {
      if (table === 'activity_logs') {
        return { insert: async () => ({ data: null, error: null }) }
      }
      if (table !== 'storefront_sections') {
        throw new Error(`Unexpected table: ${table}`)
      }
      const selectById = (cols: string, id: string) => ({
        single: async () => {
          const row = sectionsById.get(id)
          if (!row) return { data: null, error: new Error('not found') }
          if (cols === 'brand, page') {
            return { data: { brand: row.brand, page: row.page }, error: null }
          }
          return { data: row, error: null }
        },
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        eq: () => selectById(cols, id),
      })
      return {
        select: (cols: string) => ({
          eq: (_col: string, id: string) => selectById(cols, id),
        }),
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const id = `new-${sectionsById.size + 1}`
              const row = { id, sort_order: 0, ...payload }
              sectionsById.set(id, row)
              return { data: row, error: null }
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            select: (cols: string) => ({
              single: async () => {
                const existing = sectionsById.get(id)
                if (!existing) return { data: null, error: new Error('not found') }
                const updated = { ...existing, ...patch }
                sectionsById.set(id, updated)
                if (cols === 'brand, page') {
                  return { data: { brand: updated.brand, page: updated.page }, error: null }
                }
                return { data: updated, error: null }
              },
            }),
          }),
        }),
        delete: () => ({
          eq: (_col: string, id: string) => ({
            select: (cols: string) => ({
              single: async () => {
                const existing = sectionsById.get(id)
                if (!existing) return { data: null, error: new Error('not found') }
                sectionsById.delete(id)
                if (cols === 'brand, page') {
                  return { data: { brand: existing.brand, page: existing.page }, error: null }
                }
                return { data: existing, error: null }
              },
            }),
          }),
        }),
      }
    },
  }
}

function fakeSectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'section-1',
    type: 'hero',
    page: 'home',
    brand: 'spades',
    sort_order: 0,
    title: null,
    title_ja: null,
    title_ko: null,
    title_zh: null,
    subtitle: null,
    subtitle_ja: null,
    subtitle_ko: null,
    subtitle_zh: null,
    media_url: 'https://example.com/old.webp',
    link_url: null,
    collection_id: null,
    is_active: true,
    ...overrides,
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./storefront-sections')
}

describe('storefront-sections admin mutations — cache invalidation', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockInvalidate.mockClear()
  })

  it("6. CREATE invalidates the new section's (brand, page) scope", async () => {
    const mod = await freshModule()
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(new Map()))

    await mod.createStorefrontSectionImpl(
      {
        type: 'hero',
        page: 'home',
        brand: 'spades',
        mediaUrl: 'https://example.com/new.webp',
        isActive: true,
      } as never,
      FAKE_STAFF,
    )

    expect(mockInvalidate).toHaveBeenCalledWith('spades', 'home')
  })

  it("7. UPDATE invalidates the section's (brand, page) scope", async () => {
    const mod = await freshModule()
    const rows = new Map([['section-1', fakeSectionRow()]])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.updateStorefrontSectionImpl(
      {
        id: 'section-1',
        type: 'hero',
        page: 'home',
        brand: 'spades',
        mediaUrl: 'https://example.com/old.webp',
        isActive: true,
      } as never,
      FAKE_STAFF,
    )

    expect(mockInvalidate).toHaveBeenCalledWith('spades', 'home')
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
  })

  it('10. an UPDATE that only changes media_url still invalidates the scope (new video/hero image become visible immediately)', async () => {
    const mod = await freshModule()
    const rows = new Map([
      ['section-1', fakeSectionRow({ media_url: 'https://example.com/old-video.mp4' })],
    ])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.updateStorefrontSectionImpl(
      {
        id: 'section-1',
        type: 'video',
        page: 'home',
        brand: 'spades',
        mediaUrl: 'https://example.com/new-video.mp4',
        isActive: true,
      } as never,
      FAKE_STAFF,
    )

    expect(mockInvalidate).toHaveBeenCalledWith('spades', 'home')
  })

  it('11. an UPDATE that moves a section to a different brand/page invalidates BOTH the old and new scope', async () => {
    const mod = await freshModule()
    const rows = new Map([['section-1', fakeSectionRow({ brand: 'spades', page: 'home' })]])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.updateStorefrontSectionImpl(
      {
        id: 'section-1',
        type: 'hero',
        page: 'about',
        brand: 'ysrael',
        mediaUrl: 'https://example.com/old.webp',
        isActive: true,
      } as never,
      FAKE_STAFF,
    )

    expect(mockInvalidate).toHaveBeenCalledWith('spades', 'home')
    expect(mockInvalidate).toHaveBeenCalledWith('ysrael', 'about')
    expect(mockInvalidate).toHaveBeenCalledTimes(2)
  })

  it('UPDATE that fails the database write does not invalidate anything', async () => {
    const mod = await freshModule()
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(new Map()))

    await expect(
      mod.updateStorefrontSectionImpl(
        {
          id: 'does-not-exist',
          type: 'hero',
          page: 'home',
          brand: 'spades',
          mediaUrl: 'https://example.com/x.webp',
          isActive: true,
        } as never,
        FAKE_STAFF,
      ),
    ).rejects.toThrow()

    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("setStorefrontSectionActive invalidates the section's scope", async () => {
    const mod = await freshModule()
    const rows = new Map([['section-1', fakeSectionRow({ brand: 'aspire365', page: 'home' })]])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.setStorefrontSectionActiveImpl(
      { id: 'section-1', isActive: false },
      FAKE_STAFF,
    )

    expect(mockInvalidate).toHaveBeenCalledWith('aspire365', 'home')
  })

  it("8. DELETE invalidates the deleted section's scope", async () => {
    const mod = await freshModule()
    const rows = new Map([['section-1', fakeSectionRow({ brand: 'ysrael', page: 'about' })]])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.deleteStorefrontSectionImpl({ id: 'section-1' }, FAKE_STAFF)

    expect(mockInvalidate).toHaveBeenCalledWith('ysrael', 'about')
  })

  it('9. REORDER invalidates every distinct scope spanned by the reordered ids', async () => {
    const mod = await freshModule()
    const rows = new Map([
      ['s1', fakeSectionRow({ id: 's1', brand: 'spades', page: 'home' })],
      ['s2', fakeSectionRow({ id: 's2', brand: 'spades', page: 'home' })],
    ])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.reorderStorefrontSectionsImpl({ orderedIds: ['s2', 's1'] }, FAKE_STAFF)

    expect(mockInvalidate).toHaveBeenCalledWith('spades', 'home')
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
  })

  it('REORDER spanning two distinct (brand, page) scopes invalidates both', async () => {
    const mod = await freshModule()
    const rows = new Map([
      ['s1', fakeSectionRow({ id: 's1', brand: 'spades', page: 'home' })],
      ['s2', fakeSectionRow({ id: 's2', brand: 'ysrael', page: 'home' })],
    ])
    mockGetSupabaseAdminClient.mockReturnValue(fakeAdmin(rows))

    await mod.reorderStorefrontSectionsImpl({ orderedIds: ['s1', 's2'] }, FAKE_STAFF)

    expect(mockInvalidate).toHaveBeenCalledWith('spades', 'home')
    expect(mockInvalidate).toHaveBeenCalledWith('ysrael', 'home')
    expect(mockInvalidate).toHaveBeenCalledTimes(2)
  })
})
