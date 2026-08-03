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
  /** Short form of `name` for the header's "Shop X" cross-brand nav links
   *  (e.g. 'Aspire' rather than the full 'Aspire 365'). */
  shopLabel: string
  title: string
  tagline: string
  taglineJa: string
  taglineKo: string
  logoLight: string
  logoDark: string
  /** Browser-tab icon and iOS home-screen icon — falls back to the brand's
   *  own logo file where there's no dedicated square favicon asset yet
   *  (only Spades has one today). */
  faviconUrl: string
  colorHex: string
  colorDarkHex: string
  /** Text color class for the promo banner, which sits on a solid
   *  `colorHex` background — a light background (e.g. Ysrael's yellow)
   *  needs dark text; a dark background (e.g. Spades'/Aspire's red) needs
   *  white text. */
  promoBannerTextClassName: string
  /** Overrides the default neutral price-text color on product cards, for
   *  brands whose identity leans on a colored price (e.g. Ysrael's yellow)
   *  — null means "use the default gray," leaving other brands unaffected.
   *  Applied via CSS variables (see __root.tsx's brandColorStyle) rather
   *  than a prop threaded through ProductGrid/ProductCard, since it only
   *  needs to reach one style rule, not change any component's behavior. */
  priceTextHex: string | null
  priceTextDarkHex: string | null
  /** Theme a first-time visitor sees before ever toggling it themselves —
   *  an explicit stored preference (light or dark) always wins over this. */
  defaultTheme: 'light' | 'dark'
  social: { facebook: string; instagram: string; tiktok: string }
  fbPixelId: string | undefined
}

const HOSTNAME_TO_BRAND: Record<string, Brand> = {
  // www first: primaryHostnameFor() takes the first match, and the apex
  // (bare spades-official.com) may still be mid-DNS-cutover and not
  // reliably resolving to this app yet, unlike www (see DOMAIN_LIVE's doc
  // comment) — the *.vercel.app preview URL isn't listed here at all since
  // brandForHostname's `?? 'spades'` fallback already covers it, and
  // listing it here would make primaryHostnameFor('spades') wrongly prefer
  // it as the "real" domain for the admin preview link.
  'www.spades-official.com': 'spades',
  'spades-official.com': 'spades',
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
  ysrael: true,
  aspire365: true,
}

const SCOPES: Record<Brand, StorefrontScope> = {
  spades: {
    brand: 'spades',
    collectionSlug: null,
    name: 'Spades',
    shopLabel: 'Spades',
    title: 'Spades — Philippine Streetwear',
    tagline: 'Streetwear for those who bet on themselves.',
    taglineJa: '自分自身に賭ける者たちのためのストリートウェア。',
    taglineKo: '스스로에게 베팅하는 이들을 위한 스트리트웨어.',
    logoLight: '/logo-black.png',
    logoDark: '/logo-white.png',
    faviconUrl: '/favicon-32.png',
    colorHex: '#e11d2e',
    colorDarkHex: '#b3131f',
    promoBannerTextClassName: 'text-white',
    priceTextHex: null,
    priceTextDarkHex: null,
    defaultTheme: 'light',
    social: {
      facebook: 'https://www.facebook.com/spadesofficialph/',
      instagram: 'https://www.instagram.com/spades_officialph/',
      tiktok: 'https://www.tiktok.com/@spades_officialbrand',
    },
    fbPixelId: import.meta.env.VITE_FB_PIXEL_ID as string | undefined,
  },
  // Placeholder tagline/color values — replace once Ysrael has copy and a
  // brand color ready.
  ysrael: {
    brand: 'ysrael',
    collectionSlug: 'ysrael',
    name: 'Ysrael',
    shopLabel: 'Ysrael',
    title: 'Ysrael',
    tagline: '',
    taglineJa: '',
    taglineKo: '',
    logoLight: '/ysrael-logo-black.png',
    logoDark: '/ysrael-logo-white.png',
    faviconUrl: '/ysrael-logo-black.png',
    colorHex: '#f5e401',
    colorDarkHex: '#d4c400',
    promoBannerTextClassName: 'text-neutral-900',
    priceTextHex: '#d4c400',
    priceTextDarkHex: '#f5e401',
    defaultTheme: 'dark',
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
    shopLabel: 'Aspire',
    title: 'Aspire 365',
    tagline: '',
    taglineJa: '',
    taglineKo: '',
    logoLight: '/aspire365-logo-black.png',
    logoDark: '/aspire365-logo-white.png',
    faviconUrl: '/aspire365-logo-black.png',
    colorHex: '#e11d2e',
    colorDarkHex: '#b3131f',
    promoBannerTextClassName: 'text-white',
    priceTextHex: null,
    priceTextDarkHex: null,
    defaultTheme: 'dark',
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
  if (DOMAIN_LIVE[brand]) {
    const hostname = primaryHostnameFor(brand)
    if (hostname) return `https://${hostname}${path}`
  }
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}__brand=${brand}`
}

export interface CrossBrandLink {
  brand: Brand
  label: string
  url: string
}

/**
 * The *other* brands' live stores, for the header's "Shop X" cross-brand
 * nav links — never includes `currentBrand` itself (can't "shop" the store
 * you're already on), and skips any brand whose domain isn't confirmed
 * live yet (DOMAIN_LIVE), so a customer is never sent to an unfinished or
 * still-Shopify-hosted site.
 */
export function getCrossBrandLinks(currentBrand: Brand): CrossBrandLink[] {
  return BRANDS.filter((brand) => brand !== currentBrand)
    .map((brand): CrossBrandLink | null => {
      if (!DOMAIN_LIVE[brand]) return null
      const hostname = primaryHostnameFor(brand)
      if (!hostname) return null
      return {
        brand,
        label: `Shop ${SCOPES[brand].shopLabel}`,
        url: `https://${hostname}`,
      }
    })
    .filter((link): link is CrossBrandLink => link !== null)
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
