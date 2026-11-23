// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CommunityFitsSection } from './CommunityFitsSection'

// A plain anchor stands in for the router's Link (no router context in a
// unit test) — enough to check where each product link points.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    className,
    title,
  }: {
    children: React.ReactNode
    params: { slug: string }
    className?: string
    title?: string
  }) => (
    <a href={`/products/${params.slug}`} className={className} title={title}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

describe('CommunityFitsSection', () => {
  it('renders nothing with no posts', () => {
    const { container } = render(<CommunityFitsSection fits={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('links each tile to its Instagram post in a new tab with the handle', () => {
    render(
      <CommunityFitsSection
        fits={[
          {
            id: '1',
            instagramUrl: 'https://www.instagram.com/p/ABC/',
            imageUrl: 'https://example.com/a.jpg',
            handle: 'lowjell',
            products: [
              { id: 'p1', slug: 'boxy-tee', name: 'Boxy Tee' },
              { id: 'p2', slug: 'jorts', name: 'Jorts' },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByRole('heading').textContent).toMatch(/community fits/i)
    const link = screen.getByRole('link', { name: /@lowjell/ })
    expect(link.getAttribute('href')).toBe('https://www.instagram.com/p/ABC/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('@lowjell')).toBeTruthy()
    const shop = screen.getByRole('link', { name: /Shop: Boxy Tee/ })
    expect(shop.getAttribute('href')).toBe('/products/boxy-tee')
    expect(screen.getByRole('link', { name: '+1 more' })).toBeTruthy()
  })
})
