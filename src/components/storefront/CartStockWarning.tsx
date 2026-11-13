import { Link } from '@tanstack/react-router'
import type { CartStockIssue } from '#/server/cart/internal'

/**
 * Top-of-page notice for cart lines that sold out (or ran low) after being
 * added — shown on both the cart and checkout pages so the shopper fixes it
 * before filling in their details, rather than finding out at Place Order.
 * Renders nothing when every line is still available.
 */
export function CartStockWarning({
  issues,
  className,
}: {
  issues: CartStockIssue[]
  className?: string
}) {
  if (issues.length === 0) return null
  return (
    <div
      role="alert"
      className={`rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 ${className ?? ''}`}
    >
      <ul className="space-y-1.5">
        {issues.map((issue) => {
          const what = issue.variantLabel
            ? `${issue.productName} (${issue.variantLabel})`
            : issue.productName
          return (
            <li key={issue.cartItemId}>
              {issue.availableQuantity === 0 ? (
                <>
                  <strong>
                    {issue.variantLabel
                      ? `Size ${issue.variantLabel} of ${issue.productName}`
                      : issue.productName}{' '}
                    just sold out.
                  </strong>{' '}
                  {issue.variantLabel
                    ? 'Pick another size or remove it from your cart.'
                    : 'Remove it from your cart to continue.'}
                </>
              ) : (
                <>
                  <strong>
                    Only {issue.availableQuantity} left of {what}.
                  </strong>{' '}
                  Lower the quantity to {issue.availableQuantity} to continue.
                </>
              )}{' '}
              <Link
                to="/products/$slug"
                params={{ slug: issue.productSlug }}
                className="underline"
              >
                See sizes
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
