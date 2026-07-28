/**
 * Resolves which brand's storefront to render from the incoming request's
 * Host header — Spades, Ysrael, and Aspire 365 are one deployment/database
 * sharing this codebase, distinguished only by which domain the visitor
 * hit. Follows the exact pattern proven by getGeoDefaultCurrency (see
 * server/currency/geo.ts): a createServerFn reading a request header,
 * wired into __root.tsx's beforeLoad and consumed via
 * Route.useRouteContext(). Falls back to 'spades' (unscoped — the full
 * catalog, as today) for the primary domain, *.vercel.app previews, and
 * local dev, so nothing changes for Spades until the other two domains are
 * actually attached.
 *
 * Logo/color/social values below are placeholders — swap in Ysrael's and
 * Aspire 365's real assets (under public/brands/<brand>/) and brand colors
 * once supplied; nothing here is load-bearing for Spades itself.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, getRequestUrl } from '@tanstack/react-start/server'

export const BRANDS = ['spades', 'ysrael', 'aspire365'] as const
export type Brand = (typeof BRANDS)[number]

export interface StorefrontScope {
  brand: Brand
  /** The single Collection this brand's storefront is locked to — browsing,
   *  search, and direct product URLs are all constrained to it. null only
   *  for 'spades', which stays unscoped (full catalog, as today). */
  collectionSlug: string | null
  name: string
  title: string
  tagline: string
  logoLight: string
  logoDark: string
  colorHex: string
  colorDarkHex: string
  promoBannerText: string
  social: { facebook: string; instagram: string; tiktok: string }
  fbPixelId: string | undefined
}

const HOSTNAME_TO_BRAND: Record<string, Brand> = {
  'ysraelbrand.com': 'ysrael',
  'www.ysraelbrand.com': 'ysrael',
  'aspire365.co': 'aspire365',
  'www.aspire365.co': 'aspire365',
}

/**
 * Whether each brand's real domain is actually pointed at this app yet —
 * separate from HOSTNAME_TO_BRAND above, which only records the domain
 * *name* (needed so getStorefrontScope resolves it correctly the instant
 * DNS does get cut over). Until then the domain still points at its
 * current Shopify store, so anything that *links out* to it (the admin
 * preview, notification emails, etc.) must not assume it shows this app.
 * Flip a brand to `true` here once its DNS/Vercel domain is confirmed live.
 */
const DOMAIN_LIVE: Record<Brand, boolean> = {
  spades: true,
  ysrael: false,
  aspire365: true,
}

const SCOPES: Record<Brand, StorefrontScope> = {
  spades: {
    brand: 'spades',
    collectionSlug: null,
    name: 'Spades',
    title: 'Spades — Philippine Streetwear',
    tagline: 'Philippine streetwear for those who bet on themselves.',
    logoLight: '/logo-black.png',
    logoDark: '/logo-white.png',
    colorHex: '#e11d2e',
    colorDarkHex: '#b3131f',
    promoBannerText:
      'Free shipping minimum of ₱2,000 purchase. Extra 10% off minimum of 5 items',
    social: {
      facebook: 'https://www.facebook.com/spadesofficialph/',
      instagram: 'https://www.instagram.com/spades_officialph/',
      tiktok: 'https://www.tiktok.com/@spades_officialbrand',
    },
    fbPixelId: import.meta.env.VITE_FB_PIXEL_ID as string | undefined,
  },
  // Placeholder brand/collection/logo/color values — replace once Ysrael's
  // real assets and product collection exist.
  ysrael: {
    brand: 'ysrael',
    collectionSlug: 'ysrael',
    name: 'Ysrael',
    title: 'Ysrael',
    tagline: '',
    logoLight: '/logo-black.png',
    logoDark: '/logo-white.png',
    colorHex: '#e11d2e',
    colorDarkHex: '#b3131f',
    promoBannerText: '',
    social: { facebook: '', instagram: '', tiktok: '' },
    fbPixelId: import.meta.env.VITE_FB_PIXEL_ID_YSRAEL as string | undefined,
  },
  // Placeholder tagline/social values — replace once Aspire 365 has copy
  // and social links ready.
  aspire365: {
    brand: 'aspire365',
    // Matches the "Aspire 365" collection that already exists in the admin
    // (created before this feature — its slug is hyphenated, unlike the
    // brand key itself).
    collectionSlug: 'aspire-365',
    name: 'Aspire 365',
    title: 'Aspire 365',
    tagline: '',
    logoLight: '/aspire365-logo-black.png',
    logoDark: '/aspire365-logo-white.png',
    colorHex: '#e11d2e',
    colorDarkHex: '#b3131f',
    promoBannerText: '',
    social: { facebook: '', instagram: '', tiktok: '' },
    fbPixelId: import.meta.env.VITE_FB_PIXEL_ID_ASPIRE365 as string | undefined,
  },
}

function brandForHostname(hostname: string): Brand {
  return HOSTNAME_TO_BRAND[hostname.toLowerCase()] ?? 'spades'
}

/**
 * First hostname configured for `brand` in HOSTNAME_TO_BRAND, or null if
 * that brand has no real domain attached yet. Used to build an admin
 * preview link that keeps working correctly once Ysrael/Aspire 365 go
 * live — the admin itself is always reached through Spades' own domain,
 * so a *relative* preview link would show Spades' unscoped content
 * regardless of which brand the staff member picked.
 */
function primaryHostnameFor(brand: Brand): string | null {
  return (
    Object.entries(HOSTNAME_TO_BRAND).find(([, b]) => b === brand)?.[0] ?? null
  )
}

/**
 * Absolute-or-relative URL for previewing `path` (e.g. '/' or '/about') as
 * `brand` would render it, for the admin Storefront editor's preview pane.
 * - 'spades', or any brand once DOMAIN_LIVE says its domain is actually
 *   pointed at this app: a real link to that domain, so the preview is
 *   byte-for-byte what a customer sees.
 * - otherwise: falls back to the local-dev-only ?__brand= override (see
 *   getStorefrontScope) — critically, this is also the correct behavior
 *   for a brand whose domain currently points elsewhere (e.g. still on
 *   Shopify), where a real link would show that unrelated site instead of
 *   this app. Only meaningful in `vite dev`; in production this shows a
 *   relative link, since the debug override doesn't exist there.
 */
export function getBrandPreviewUrl(brand: Brand, path: string): string {
  if (brand === 'spades') return path
  if (DOMAIN_LIVE[brand]) {
    const hostname = primaryHostnameFor(brand)
    if (hostname) return `https://${hostname}${path}`
  }
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}__brand=${brand}`
}

export const getStorefrontScope = createServerFn({ method: 'GET' }).handler(
  (): StorefrontScope => {
    // Dev-only convenience: previewing Ysrael/Aspire 365 for real requires
    // hitting their actual domain, which local dev can't do without editing
    // /etc/hosts (and Vite's dev server blocks arbitrary Host headers by
    // default). ?__brand=ysrael on localhost sidesteps that entirely — never
    // active outside `vite dev` (import.meta.env.DEV is false in any real
    // build, including Vercel preview deployments).
    if (import.meta.env.DEV) {
      const debugBrand = getRequestUrl().searchParams.get('__brand')
      if (debugBrand && debugBrand in SCOPES) {
        return SCOPES[debugBrand as Brand]
      }
    }

    const host = getRequestHeader('host') ?? ''
    // Strip a port (e.g. "localhost:3000") before matching.
    const hostname = host.split(':')[0]
    return SCOPES[brandForHostname(hostname)]
  },
)
