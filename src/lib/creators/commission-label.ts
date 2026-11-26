/**
 * How an attributed order's commission rate reads to staff and creators.
 * Affiliate sale mode (0135) snapshots a rate per order line, so an order
 * may have earned below the code's normal rate: all lines at one sale rate
 * read "Sale-day commission 2%", a mix reads "5% + 2% sale-day".
 */
export function commissionRateLabel(attribution: {
  commission_bps: number
  rate_breakdown: { rate_bps: number; revenue_cents: number }[] | null
}): string {
  const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`
  const normal = attribution.commission_bps
  const rates = new Set(
    (attribution.rate_breakdown ?? [])
      .filter((line) => line.revenue_cents > 0)
      .map((line) => line.rate_bps),
  )
  const saleRates = [...rates].filter((bps) => bps !== normal)
  if (saleRates.length === 0) return `${pct(normal)} commission`
  const saleLabel = saleRates.map(pct).join(' / ')
  return rates.has(normal)
    ? `${pct(normal)} + ${saleLabel} sale-day commission`
    : `Sale-day commission ${saleLabel}`
}
