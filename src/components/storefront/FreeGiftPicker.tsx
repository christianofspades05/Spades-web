import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import {
  getFreeGiftChoices,
  selectFreeGift,
} from '#/server/cart/free-gift-actions'
import type { FreeGiftChoice, FreeGiftOffer } from '#/server/cart/free-gift'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { getErrorMessage } from '#/lib/utils/errors'
import { optimizedImageUrl } from '#/lib/utils/image-optimize'

/**
 * Checkout section for a free gift deal (see src/server/cart/free-gift.ts):
 * once the cart qualifies, the customer picks one free item (and size) from
 * the deal's collections. The pick is saved on the cart, so `onChanged`
 * just re-reads the cart to show it in the order summary.
 */
export function FreeGiftPicker({
  offer,
  onChanged,
}: {
  offer: FreeGiftOffer
  onChanged: () => Promise<void> | void
}) {
  const { t } = useLanguage()
  const [choices, setChoices] = useState<FreeGiftChoice[] | null>(null)
  const [openProductId, setOpenProductId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qualifies = offer.itemsNeeded === 0

  useEffect(() => {
    if (!qualifies) return
    let cancelled = false
    getFreeGiftChoices()
      .then((result) => {
        if (!cancelled) setChoices(result)
      })
      .catch(() => {
        if (!cancelled) setChoices([])
      })
    return () => {
      cancelled = true
    }
  }, [offer.discountId, qualifies])

  async function pick(variantId: string | null) {
    setSaving(true)
    setError(null)
    try {
      await selectFreeGift({ data: { variantId } })
      await onChanged()
      setOpenProductId(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!qualifies) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t.cart.freeGiftNudge(offer.itemsNeeded)}
      </p>
    )
  }
  // Nothing left in stock to give — place-order doesn't require a pick then.
  if (choices !== null && choices.length === 0) return null

  return (
    <section className="rounded-lg border-2 border-amber-400 p-4 dark:border-amber-500/70">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Gift className="h-5 w-5" aria-hidden="true" />
        {t.cart.freeGiftTitle}
      </h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {offer.title} · {t.cart.freeGiftHint}
      </p>

      {offer.pick ? (
        <div className="mt-4 flex items-center gap-3 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
          <div className="h-16 w-14 shrink-0 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            {offer.pick.imageUrl && (
              <img
                src={optimizedImageUrl(offer.pick.imageUrl, 128)}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              {t.cart.freeGiftChosen}
            </p>
            <p className="text-sm font-medium">{offer.pick.productName}</p>
            {offer.pick.variantLabel && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {offer.pick.variantLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void pick(null)}
            className="text-sm underline"
          >
            {t.cart.freeGiftChange}
          </button>
        </div>
      ) : choices === null ? (
        <div className="mt-4 h-24 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-900" />
      ) : (
        <ul className="mt-4 grid max-h-[28rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {choices.map((choice) => {
            const open = openProductId === choice.productId
            const single =
              choice.variants.length === 1 ? choice.variants[0] : null
            return (
              <li key={choice.productId}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    single
                      ? void pick(single.variantId)
                      : setOpenProductId(open ? null : choice.productId)
                  }
                  className={`block w-full overflow-hidden rounded-md border text-left transition ${
                    open
                      ? 'border-neutral-900 dark:border-white'
                      : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800'
                  }`}
                >
                  <div className="aspect-[4/5] bg-neutral-100 dark:bg-neutral-900">
                    {choice.imageUrl && (
                      <img
                        src={optimizedImageUrl(choice.imageUrl, 256)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <p className="line-clamp-2 px-2 py-1.5 text-xs font-medium">
                    {choice.productName}
                  </p>
                </button>
                {open && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {t.cart.freeGiftPickSize}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {choice.variants.map((variant) => (
                        <button
                          key={variant.variantId}
                          type="button"
                          disabled={saving}
                          onClick={() => void pick(variant.variantId)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
                        >
                          {variant.label ?? t.cart.freeGiftTitle}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>
      )}
    </section>
  )
}
