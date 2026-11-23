// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('shows the handle and product links, and opens the photo full-size', () => {
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
    // The photo itself isn't a link (no jump to Instagram) — just the handle.
    expect(screen.getByText('@lowjell')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /@lowjell/ })).toBeNull()
    expect(document.querySelector('a[href*="instagram.com"]')).toBeNull()
    const shop = screen.getByRole('link', { name: /Shop: Boxy Tee/ })
    expect(shop.getAttribute('href')).toBe('/products/boxy-tee')
    expect(screen.getByRole('link', { name: '+1 more' })).toBeTruthy()

    // Tapping the photo opens it full-size with every tagged product.
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: "View @lowjell's photo" }),
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('img')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Shop: Jorts' }).getAttribute('href'),
    ).toBe('/products/jorts')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
