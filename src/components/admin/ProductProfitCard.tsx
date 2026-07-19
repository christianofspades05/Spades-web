import { Card } from '#/components/admin/Card'
import { formatCentsAsPHP } from '#/lib/utils/money'

export interface ProductProfitCardData {
  productId: string | null
  productName: string
  unitsSold: number
  grossSalesCents: number
  netProfitCents: number
  marginPct: number | null
}

/** Mobile card rendering of a product-profit row — table equivalent is the desktop-only breakdown table on the Profit page. */
export function ProductProfitCard({
  product,
}: {
  product: ProductProfitCardData
}) {
  return (
    <Card className="p-4">
      <p className="font-medium text-neutral-900">{product.productName}</p>
      <p className="mt-1 text-sm text-neutral-500">
        {product.unitsSold} sold · {formatCentsAsPHP(product.grossSalesCents)}{' '}
        gross
      </p>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-emerald-600">
          {formatCentsAsPHP(product.netProfitCents)} profit
        </span>
        <span className="text-xs text-neutral-400">
          {product.marginPct !== null
            ? `${product.marginPct.toFixed(1)}% margin`
            : '—'}
        </span>
      </div>
    </Card>
  )
}
