import { ProductGrid } from '#/components/storefront/ProductGrid'
import { buttonPrimaryClassName } from '#/components/storefront/ui'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import type { RenderedStorefrontSection } from '#/server/storefront/sections'

export function SectionBlock({
  section,
}: {
  section: RenderedStorefrontSection
}) {
  const { t, language } = useLanguage()

  switch (section.type) {
    case 'hero':
      if (!section.media_url) return null
      return (
        // Plain <a>, not the typed <Link> — link_url is a staff-entered
        // destination that may be internal or a fully external URL, neither
        // of which the router's compile-time-typed route literals can cover.
        <a href={section.link_url || '/products'} className="block">
          <img
            src={section.media_url}
            alt={section.title ?? ''}
            className="h-auto w-full object-cover"
          />
        </a>
      )

    case 'tagline': {
      const taglineTitle =
        (language === 'ja'
          ? section.title_ja
          : language === 'ko'
            ? section.title_ko
            : language === 'zh'
              ? section.title_zh
              : null) || section.title
      const taglineSubtitle =
        (language === 'ja'
          ? section.subtitle_ja
          : language === 'ko'
            ? section.subtitle_ko
            : language === 'zh'
              ? section.subtitle_zh
              : null) || section.subtitle
      return (
        <section className="bg-neutral-950 py-12 text-center text-white sm:py-16">
          <div className="mx-auto max-w-2xl px-6">
            {taglineTitle && (
              <h2 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
                {taglineTitle}
              </h2>
            )}
            {taglineSubtitle && (
              <p className="mt-3 whitespace-pre-line text-sm text-neutral-300 sm:text-base">
                {taglineSubtitle}
              </p>
            )}
          </div>
        </section>
      )
    }

    case 'image':
      if (!section.media_url) return null
      return section.link_url ? (
        <a href={section.link_url} className="block">
          <img
            src={section.media_url}
            alt={section.title ?? ''}
            className="h-auto w-full object-cover"
          />
        </a>
      ) : (
        <img
          src={section.media_url}
          alt={section.title ?? ''}
          className="h-auto w-full object-cover"
        />
      )

    case 'video':
      if (!section.media_url) return null
      return (
        <video
          src={section.media_url}
          className="aspect-video w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
        />
      )

    case 'product_grid': {
      if (!section.collectionSlug || section.products.length === 0) {
        return null
      }
      const gridTitle =
        (language === 'ja'
          ? section.titleJa
          : language === 'ko'
            ? section.titleKo
            : language === 'zh'
              ? section.titleZh
              : null) || section.title
      return (
        <section className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
          {gridTitle && (
            <h2 className="mb-8 text-center text-sm font-bold uppercase tracking-[0.2em] text-neutral-950 dark:text-white">
              {gridTitle}
            </h2>
          )}
          <ProductGrid
            products={section.products}
            emptyMessage={t.collections.noProductsYet}
            columns={5}
          />
          <div className="mt-10 flex justify-center">
            <a
              href={
                section.linkUrl || `/collections/${section.collectionSlug}`
              }
              className={buttonPrimaryClassName}
            >
              {t.collections.viewAll}
            </a>
          </div>
        </section>
      )
    }

    default:
      return null
  }
}
