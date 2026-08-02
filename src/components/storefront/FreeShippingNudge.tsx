import { useCurrency } from '#/lib/currency/CurrencyContext'
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
  if (!progress) return null
  return (
    <p className={className}>
      {progress.type === 'amount'
        ? `Add ${formatPrice(progress.remaining)} more to unlock free shipping`
        : `Add ${progress.remaining} more item${progress.remaining === 1 ? '' : 's'} to unlock free shipping`}
    </p>
  )
}
