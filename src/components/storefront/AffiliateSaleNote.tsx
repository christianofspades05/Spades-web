import type { AffiliateCodeRates } from '#/server/cart/discount'
import { useLanguage } from '#/lib/i18n/LanguageContext'

function pct(value: number): string {
  return `${Number(value.toFixed(2))}%`
}

/**
 * Under an applied affiliate code, when some cart lines are already on
 * sale: explains the code is adding its smaller sale-mode discount there
 * (see resolveAffiliateCode in server/cart/discount.ts). Nothing to say
 * when every line is at full price — the code's normal % just applies.
 */
export function AffiliateSaleNote({
  affiliate,
}: {
  affiliate: AffiliateCodeRates | undefined
}) {
  const { t } = useLanguage()
  if (!affiliate || affiliate.saleItemIds.length === 0) return null
  const sale = pct(affiliate.salePercent)
  const normal = pct(affiliate.normalPercent)
  return (
    <div className="mt-1.5 text-xs text-green-800 dark:text-green-300">
      <p>{t.cart.affiliateSaleOnly(affiliate.code, sale, normal)}</p>
      {affiliate.normalItemIds.length > 0 && (
        <p className="mt-0.5">{t.cart.affiliateSaleMixed(normal, sale)}</p>
      )}
    </div>
  )
}
