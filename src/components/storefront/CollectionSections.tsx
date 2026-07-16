import { Link } from '@tanstack/react-router'
import { ProductGrid } from './ProductGrid'
import { buttonSecondaryClassName } from './ui'
import { MAX_PRODUCTS_SHOWN } from '#/server/collections/sections'
import type { StorefrontCollectionSection } from '#/server/collections/sections'

const PRODUCTS_PER_ROW = 5

interface CollectionSectionsProps {
  sections: StorefrontCollectionSection[]
}

export function CollectionSections({ sections }: CollectionSectionsProps) {
  return (
    <div className="space-y-16">
      {sections
        .filter((section) => section.products.length > 0)
        .map((section) => (
          <section key={section.slug}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold uppercase tracking-wide">
                {section.title}
              </h2>
            </div>
            <ProductGrid
              products={section.products}
              columns={PRODUCTS_PER_ROW}
            />
            {section.total > MAX_PRODUCTS_SHOWN && (
              <div className="mt-8 flex justify-center">
                <Link
                  to="/collections/$slug"
                  params={{ slug: section.slug }}
                  className={buttonSecondaryClassName}
                >
                  View all
                </Link>
              </div>
            )}
          </section>
        ))}
    </div>
  )
}
