import type { AppliedCartDiscount } from '#/server/cart/discount'
import { buildDiscountBreakdown } from '#/lib/discounts/breakdown'
import { useLanguage } from '#/lib/i18n/LanguageContext'

/**
 * The cart/checkout "Discount" rows, one per discount that applied — e.g.
 * the store-wide sale, then "Bundle deal: extra 10% off (3+ items)", then
 * the customer's code — instead of a single combined amount. `totalCents`
 * is the combined amount actually being charged; the rows add up to it.
 */
export function DiscountBreakdown({
  discount,
  totalCents,
  formatPrice,
  label,
  className = 'flex items-center justify-between text-green-700 dark:text-green-400',
}: {
  discount: AppliedCartDiscount | null | undefined
  totalCents: number
  formatPrice: (cents: number) => string
  /** Fallback single-row label ("Discount"). */
  label: string
  className?: string
}) {
  const { t } = useLanguage()
  if (totalCents <= 0) return null

  const parts = buildDiscountBreakdown(discount, totalCents)
  if (parts.length === 0) {
    return (
      <div className={className}>
        <span>{label}</span>
        <span>-{formatPrice(totalCents)}</span>
      </div>
    )
  }

  const rate = (type: string, value: number) =>
    type === 'fixed_amount' ? `${formatPrice(value)} off` : `${value}% off`

  return (
    <>
      {parts.map((part, index) => {
        const text =
          part.kind === 'code'
            ? part.affiliate
              ? t.cart.discountCodeLine(part.code ?? part.title)
              : `${t.cart.discountCodeLine(part.code ?? part.title)} (${rate(part.type, part.value)})`
            : part.kind === 'bundle'
              ? t.cart.bundleLine(
                  rate(part.type, part.value),
                  part.minQuantity ?? 0,
                )
              : part.type === 'free_shipping'
                ? part.title
                : `${part.title} (${rate(part.type, part.value)})`
        return (
          <div key={`${part.title}-${index}`} className={className}>
            <span>{text}</span>
            <span className="shrink-0 pl-3">
              -{formatPrice(part.amountCents)}
            </span>
          </div>
        )
      })}
    </>
  )
}
