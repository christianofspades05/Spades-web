import type { Translations } from '#/lib/i18n/translations'

/** Storefront collection sections shown on /collections, in display order.
 *  titleKey looks up the actual display string in the active language's
 *  translations.collections (see lib/i18n/translations.ts) — this file
 *  itself stays language-agnostic since it's also used server-side, where
 *  the visitor's language isn't known. */
export const STOREFRONT_COLLECTIONS = [
  { slug: 'graphic-tees', titleKey: 'graphicTees' },
  { slug: 'sando', titleKey: 'muscleTees' },
  { slug: 'polo-shirts', titleKey: 'poloShirts' },
  { slug: 'jackets', titleKey: 'hoodiesJackets' },
  { slug: 'mesh-shorts', titleKey: 'meshShorts' },
  { slug: 'jorts', titleKey: 'jorts' },
  { slug: 'pants', titleKey: 'bottoms' },
  { slug: 'jersey', titleKey: 'jerseyTee' },
  { slug: 'perfume', titleKey: 'essentials' },
  { slug: 'blanks', titleKey: 'blanks' },
] as const satisfies {
  slug: string
  titleKey: keyof Translations['collections']
}[]

export type StorefrontCollectionSlug =
  (typeof STOREFRONT_COLLECTIONS)[number]['slug']

/** Slugs (e.g. "best-sellers") that aren't in STOREFRONT_COLLECTIONS still need a readable title on their /collections/$slug page. */
function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function collectionTitleForSlug(
  slug: string,
  t: Translations,
): string {
  const titleKey = STOREFRONT_COLLECTIONS.find((c) => c.slug === slug)
    ?.titleKey
  return titleKey ? t.collections[titleKey] : titleCaseSlug(slug)
}
