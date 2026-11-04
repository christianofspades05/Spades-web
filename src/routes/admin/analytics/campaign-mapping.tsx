import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Package,
  Search,
  X,
} from 'lucide-react'
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

type SortKey = 'campaignName' | 'lastSpendDate' | 'spendCents'
type SortDir = 'asc' | 'desc'

// Text sorts ascending (A→Z) by default; the two numeric/date columns sort
// descending (most recent/highest spend first) by default — matches what
// someone clicking that header is almost always trying to see.
const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  campaignName: 'asc',
  lastSpendDate: 'desc',
  spendCents: 'desc',
}

function SortButton({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  dir: SortDir
  onClick: (key: SortKey) => void
  align?: 'right'
}) {
  const isActive = sortKey === activeKey
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`flex items-center gap-1 ${align === 'right' ? 'ml-auto' : ''} ${
        isActive
          ? 'text-neutral-900'
          : 'text-neutral-500 hover:text-neutral-700'
      }`}
    >
      {label}
      <Icon size={12} />
    </button>
  )
}

function CampaignMappingPage() {
  const rows = Route.useLoaderData()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('spendCents')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_SORT_DIR[key])
    }
  }

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = term
      ? rows.filter((row) => row.campaignName.toLowerCase().includes(term))
      : rows
    const sign = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'campaignName') {
        return sign * a.campaignName.localeCompare(b.campaignName)
      }
      return (
        sign * (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0)
      )
    })
  }, [rows, search, sortKey, sortDir])

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Campaign Mapping"
        subtitle="Match each Meta ad campaign to the product it advertises, so the Ads Efficiency page can show ROAS and cost per purchase per campaign."
      />

      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs text-neutral-500">
            Campaigns with any ad spend in the last 90 days. ROAS on the Ads
            Efficiency page is based on the mapped product's own order history —
            not click-level attribution — so it also includes that product's
            sales from outside this specific campaign.
          </p>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns…"
              className={`${inputClassName} w-56 pl-7 text-sm`}
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">
            No campaigns with spend in the last 90 days.
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">
            No campaigns match "{search}".
          </p>
        ) : (
          <div className={`${tableWrapperClassName} mt-5`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>
                      <SortButton
                        label="Campaign"
                        sortKey="campaignName"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={handleSort}
                      />
                    </th>
                    <th className={tableHeadClassName}>
                      <SortButton
                        label="Last spend"
                        sortKey="lastSpendDate"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={handleSort}
                      />
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      <SortButton
                        label="Spend (90d)"
                        sortKey="spendCents"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={handleSort}
                        align="right"
                      />
                    </th>
                    <th className={tableHeadClassName}>Mapped product</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.campaignName} className={tableRowClassName}>
                      <td className={tableCellClassName}>{row.campaignName}</td>
                      <td className={tableCellClassName}>
                        {row.lastSpendDate}
                      </td>
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
