// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CommunityFitsSection } from './CommunityFitsSection'

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
  })
})
