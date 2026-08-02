import { useCurrency } from '#/lib/currency/CurrencyContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import type { FreeShippingProgress } from '#/lib/checkout/shipping'

/** "Add X more to unlock free shipping" — shown wherever a customer hasn't
 *  yet met the free-shipping threshold for their (browsing surfaces: geo-
 *  guessed, checkout: actually selected) destination. Renders nothing once
 *  `progress` is null (threshold met, or nothing configured to reach). */
export function FreeShippingNudge({
  progress,
  className = 'text-center text-xs font-medium text-neutral-600 dark:text-neutral-400',
}: {
  progress: FreeShippingProgress | null
  className?: string
}) {
  const { formatPrice } = useCurrency()
  const { t } = useLanguage()
  if (!progress) return null
  return (
    <p className={className}>
      {progress.type === 'amount'
        ? t.freeShipping.addMoreAmount(formatPrice(progress.remaining))
        : t.freeShipping.addMoreItems(progress.remaining)}
    </p>
  )
}
