import { useState } from 'react'
import { Package, Search, X } from 'lucide-react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  getCampaignMappings,
  upsertCampaignMapping,
} from '#/server/admin/campaign-mapping'
import type { CampaignMappingRow } from '#/server/admin/campaign-mapping'
import { searchProductsForPicker } from '#/server/admin/products'
import type { ProductPickerResult } from '#/server/admin/products'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/analytics/campaign-mapping')({
  loader: () => getCampaignMappings(),
  component: CampaignMappingPage,
})

function ProductSearchCell({ row }: { row: CampaignMappingRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductPickerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    try {
      const found = await searchProductsForPicker({
        data: { q: query || undefined },
      })
      setResults(found)
    } finally {
      setLoading(false)
    }
  }

  async function handlePick(productId: string | null) {
    setSaving(true)
    try {
      await upsertCampaignMapping({
        data: { campaignName: row.campaignName, productId },
      })
      setOpen(false)
      setQuery('')
      setResults([])
      router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {row.productId ? (
          <>
            {row.productImage ? (
              <img
                src={row.productImage}
                alt=""
                className="size-7 rounded-md border border-neutral-200 object-cover"
              />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                <Package size={12} className="text-neutral-300" />
              </div>
            )}
            <span className="text-sm text-neutral-900">{row.productName}</span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Change
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handlePick(null)}
              className="text-xs font-medium text-neutral-400 hover:text-red-600"
            >
              Unmap
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
          >
            Map a product
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products…"
            className={`${inputClassName} w-48 pl-7 text-sm`}
          />
        </div>
        <button
          type="submit"
          className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
        >
          {loading ? '…' : 'Search'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setResults([])
          }}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X size={14} />
        </button>
      </form>
      {results.length > 0 && (
        <Card className="max-w-xs p-1.5">
          <ul>
            {results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handlePick(product.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-50"
                >
                  {product.image ? (
                    <img
                      src={product.image}
                      alt=""
                      className="size-6 rounded border border-neutral-200 object-cover"
                    />
                  ) : (
                    <div className="flex size-6 items-center justify-center rounded border border-neutral-200 bg-neutral-50">
                      <Package size={10} className="text-neutral-300" />
                    </div>
                  )}
                  <span className="text-neutral-900">{product.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function CampaignMappingPage() {
  const rows = Route.useLoaderData()

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Campaign Mapping"
        subtitle="Match each Meta ad campaign to the product it advertises, so the Ads Efficiency page can show ROAS and cost per purchase per campaign."
      />

      <Card className="mt-5 p-5">
        <p className="text-xs text-neutral-500">
          Campaigns with any ad spend in the last 90 days. ROAS on the Ads
          Efficiency page is based on the mapped product's own order history —
          not click-level attribution — so it also includes that product's sales
          from outside this specific campaign.
        </p>

        {rows.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">
            No campaigns with spend in the last 90 days.
          </p>
        ) : (
          <div className={`${tableWrapperClassName} mt-5`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Campaign</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Spend (90d)
                    </th>
                    <th className={tableHeadClassName}>Mapped product</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.campaignName} className={tableRowClassName}>
                      <td className={tableCellClassName}>{row.campaignName}</td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(row.spendCents)}
                      </td>
                      <td className={tableCellClassName}>
                        <ProductSearchCell row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
