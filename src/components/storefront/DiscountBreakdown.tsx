import type { AppliedCartDiscount } from '#/server/cart/discount'
import { useLanguage } from '#/lib/i18n/LanguageContext'

interface Part {
  key: string
  label: string
  amountCents: number
}

/**
 * The cart/checkout "Discount" rows, one per discount that applied — e.g.
 * the store-wide sale, then "Bundle deal: extra 10% off (3+ items)", then
 * the customer's code — instead of a single combined amount.
 *
 * `totalCents` is the combined amount actually being charged (checkout
 * applies the market markup to it); each line is scaled to it so the rows
 * always add up exactly to what's subtracted from the total.
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

  const rate = (type: string, value: number) =>
    type === 'fixed_amount' ? `${formatPrice(value)} off` : `${value}% off`
  const describe = (d: {
    title: string
    type: AppliedCartDiscount['type']
    value: number
    minQuantity?: number | null
  }) =>
    d.minQuantity
      ? t.cart.bundleLine(rate(d.type, d.value), d.minQuantity)
      : d.type === 'free_shipping'
        ? d.title
        : `${d.title} (${rate(d.type, d.value)})`

  if (!discount) {
    return (
      <div className={className}>
        <span>{label}</span>
        <span>-{formatPrice(totalCents)}</span>
      </div>
    )
  }

  const stacked = discount.stackedWith.filter((s) => s.amountCents > 0)
  const stackedCents = stacked.reduce((sum, s) => sum + s.amountCents, 0)
  const primaryLabel = discount.code
    ? discount.affiliate
      ? t.cart.discountCodeLine(discount.code)
      : `${t.cart.discountCodeLine(discount.code)} (${rate(discount.type, discount.value)})`
    : describe(discount)
  // The code goes last (it's applied on top of the sales); an automatic
  // leader (the biggest sale) goes first.
  const primary: Part = {
    key: discount.id,
    label: primaryLabel,
    amountCents: Math.max(0, discount.amountCents - stackedCents),
  }
  const others: Part[] = stacked.map((s, index) => ({
    key: `${s.title}-${index}`,
    label: describe(s),
    amountCents: s.amountCents,
  }))
  const parts = (
    discount.code ? [...others, primary] : [primary, ...others]
  ).filter((part) => part.amountCents > 0)

  const rawTotal = parts.reduce((sum, part) => sum + part.amountCents, 0)
  let remaining = totalCents
  const scaled = parts.map((part, index) => {
    const cents =
      index === parts.length - 1
        ? remaining
        : Math.round((part.amountCents * totalCents) / rawTotal)
    remaining -= cents
    return { ...part, amountCents: cents }
  })

  return (
    <>
      {scaled.map((part) => (
        <div key={part.key} className={className}>
          <span>{part.label}</span>
          <span className="shrink-0 pl-3">
            -{formatPrice(part.amountCents)}
          </span>
        </div>
      ))}
    </>
  )
}
