/** Storefront collection sections shown on /collections, in display order. */
export const STOREFRONT_COLLECTIONS = [
  { slug: 'graphic-tees', title: 'Graphic Tees' },
  { slug: 'sando', title: 'Muscle Tees' },
  { slug: 'polo-shirts', title: 'Polo Shirts' },
  { slug: 'jackets', title: 'Hoodies & Jackets' },
  { slug: 'mesh-shorts', title: 'Mesh Shorts' },
  { slug: 'jorts', title: 'Jorts' },
  { slug: 'pants', title: 'Bottoms' },
  { slug: 'jersey', title: 'Jersey Tee' },
  { slug: 'perfume', title: 'Essentials' },
  { slug: 'blanks', title: 'Blanks' },
] as const

export type StorefrontCollectionSlug =
  (typeof STOREFRONT_COLLECTIONS)[number]['slug']

/** Slugs (e.g. "best-sellers") that aren't in STOREFRONT_COLLECTIONS still need a readable title on their /collections/$slug page. */
function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function collectionTitleForSlug(slug: string): string {
  const known = STOREFRONT_COLLECTIONS.find((c) => c.slug === slug)?.title
  return known ?? titleCaseSlug(slug)
}
