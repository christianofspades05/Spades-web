import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Radio, RefreshCw, Search } from 'lucide-react'
import {
  finalizeShift,
  generateBasket,
  getShift,
  listTodaysShifts,
  replaceBasketItem,
  setSellerPick,
} from '#/server/admin/live-planner'
import type { LiveBasketItemView } from '#/server/admin/live-planner'
import { searchProductsForPicker } from '#/server/admin/products'
import type { ProductPickerResult } from '#/server/admin/products'
import { daysAgo } from '#/lib/utils/date-range'
import { useDebouncedValue } from '#/lib/hooks/useDebouncedValue'
import { getErrorMessage } from '#/lib/utils/errors'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
} from '#/components/admin/ui'
import type {
  LiveBasketCategory,
  LiveReplacementReason,
  LiveShiftSlot,
} from '#/types/live-planner'

const SHIFT_OPTIONS: Array<{ value: LiveShiftSlot; label: string }> = [
  { value: '10am_2pm', label: '10AM–2PM' },
  { value: '6pm_10pm', label: '6PM–10PM' },
  { value: '10pm_2am', label: '10PM–2AM' },
]

const CATEGORY_LABELS: Record<LiveBasketCategory, string> = {
  proven: '🔥 Proven Seller',
  priority: '🆕 Priority / New',
  inventory_push: '📦 Inventory Push',
  test: '🧪 Test',
  seller_pick: "👑 Seller's Pick",
}

const REPLACEMENT_REASONS: Array<{
  value: LiveReplacementReason
  label: string
}> = [
  { value: 'viewer_request', label: 'Viewer request' },
  { value: 'low_engagement', label: 'Low engagement' },
  { value: 'product_sold_out', label: 'Product sold out' },
  { value: 'size_sold_out', label: 'Size sold out' },
  { value: 'seller_judgment', label: "Seller's judgment" },
  { value: 'management_request', label: 'Management request' },
  { value: 'other', label: 'Other' },
]

export const Route = createFileRoute('/admin/live-product-planner/')({
  validateSearch: z.object({
    liveDate: z.string().optional(),
    shift: z.enum(['10am_2pm', '6pm_10pm', '10pm_2am']).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const liveDate = deps.liveDate ?? daysAgo(0)
    const shift = deps.shift ?? '10am_2pm'
    const [todaysShifts, currentShift] = await Promise.all([
      listTodaysShifts({ data: { liveDate } }),
      getShift({ data: { liveDate, shift } }),
    ])
    return { liveDate, shift, todaysShifts, currentShift }
  },
  component: LiveProductPlannerPage,
})

function LiveProductPlannerPage() {
  const { liveDate, shift, todaysShifts, currentShift } =
    Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null)
  const [showSellerPickSearch, setShowSellerPickSearch] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      await generateBasket({ data: { liveDate, shift } })
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setGenerating(false)
    }
  }

  const items = currentShift?.items ?? []
  const sellerPick = items.find((i) => i.category === 'seller_pick')
  const autoItems = items.filter((i) => i.category !== 'seller_pick')

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="TikTok LIVE Product Planner"
        subtitle="Recommends which products to feature in each 4-hour LIVE shift, using recent sales, inventory, and rotation history."
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SHIFT_OPTIONS.map((opt) => {
          const shiftInfo = todaysShifts.find((s) => s.shift === opt.value)
          const ready = (shiftInfo?.itemCount ?? 0) >= 11
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                navigate({ search: (prev) => ({ ...prev, shift: opt.value }) })
              }
              className={`rounded-xl border p-4 text-left transition ${
                shift === opt.value
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
            >
              <p className="text-sm font-semibold">{opt.label}</p>
              <p
                className={`mt-1 text-xs ${
                  shift === opt.value
                    ? 'text-neutral-300'
                    : ready
                      ? 'text-emerald-600'
                      : 'text-neutral-400'
                }`}
              >
                {ready ? 'READY' : 'NOT READY'} · {shiftInfo?.itemCount ?? 0}{' '}
                products
              </p>
            </button>
          )
        })}
      </div>

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
            LIVE date
            <input
              type="date"
              value={liveDate}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({ ...prev, liveDate: e.target.value }),
                })
              }
              className={inputClassName}
            />
          </label>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className={`${buttonPrimaryClassName} mt-5 gap-2`}
          >
            <RefreshCw
              size={16}
              className={generating ? 'animate-spin' : ''}
            />
            {items.length > 0
              ? generating
                ? 'Regenerating…'
                : 'Generate Different Basket'
              : generating
                ? 'Generating…'
                : 'Generate 12-Product Basket'}
          </button>
          {currentShift && (
            <span className="mt-5 text-xs text-neutral-500">
              Status:{' '}
              <span className="font-medium capitalize">
                {currentShift.status}
              </span>
            </span>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      {currentShift?.varietySummary && (
        <VarietySummaryCard summary={currentShift.varietySummary} />
      )}

      {items.length === 0 ? (
        <Card className="mt-4 p-8 text-center text-sm text-neutral-400">
          No basket generated yet for this shift.
        </Card>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {autoItems.map((item) => (
            <BasketItemCard
              key={item.id}
              item={item}
              onReplace={() => setReplacingItemId(item.id)}
            />
          ))}

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-700">
                  12
                </span>
                <div>
                  <p className="text-xs font-semibold tracking-wide text-amber-700 uppercase">
                    {CATEGORY_LABELS.seller_pick}
                  </p>
                  <p className="text-sm font-medium text-neutral-900">
                    {sellerPick ? sellerPick.productName : 'Not yet chosen'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSellerPickSearch((v) => !v)}
                className={buttonSecondaryClassName}
              >
                {sellerPick ? 'Change' : 'Choose'}
              </button>
            </div>
            {showSellerPickSearch && currentShift && (
              <SellerPickSearch
                shiftId={currentShift.id}
                onPicked={async () => {
                  setShowSellerPickSearch(false)
                  await router.invalidate()
                }}
              />
            )}
          </Card>

          {currentShift && currentShift.status === 'draft' && sellerPick && (
            <div className="mt-2 flex justify-end">
              <FinalizeButton shiftId={currentShift.id} />
            </div>
          )}
        </div>
      )}

      {replacingItemId && (
        <ReplaceItemDialog
          itemId={replacingItemId}
          onClose={() => setReplacingItemId(null)}
          onReplaced={async () => {
            setReplacingItemId(null)
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}

function VarietySummaryCard({
  summary,
}: {
  summary: NonNullable<
    Awaited<ReturnType<typeof getShift>>
  >['varietySummary']
}) {
  if (!summary) return null
  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Today's Basket
        </h2>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-600">
            New vs yesterday:{' '}
            <span className="font-semibold text-neutral-900">
              {summary.newCount}/{summary.totalCount}
            </span>
          </span>
          <span className="text-neutral-600">
            Repeated:{' '}
            <span className="font-semibold text-neutral-900">
              {summary.repeatedCount}/{summary.totalCount}
            </span>
          </span>
          <span className="text-neutral-600">
            7-day unique products:{' '}
            <span className="font-semibold text-neutral-900">
              {summary.sevenDayUniqueProductCount}
            </span>
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              summary.varietyScorePct >= 60
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            Variety score: {summary.varietyScorePct}%
          </span>
        </div>
      </div>
      {summary.repeated.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
          {summary.repeated.map((r) => (
            <p key={r.productId}>
              <span className="font-medium text-neutral-700">
                {r.productName}
              </span>{' '}
              — REPEATED · {r.reason}
            </p>
          ))}
        </div>
      )}
    </Card>
  )
}

function BasketItemCard({
  item,
  onReplace,
}: {
  item: LiveBasketItemView
  onReplace: () => void
}) {
  const snapshot = item.scoreSnapshot
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-xs font-semibold text-neutral-700">
            {item.recommendedOrder}
          </span>
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="size-14 shrink-0 rounded-md border border-neutral-200 object-cover"
            />
          ) : (
            <div className="size-14 shrink-0 rounded-md border border-neutral-200 bg-neutral-50" />
          )}
          <div>
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {CATEGORY_LABELS[item.category]}
            </p>
            <p className="text-sm font-medium text-neutral-900">
              {item.productName}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Stock: {item.currentStockOnHand}
              {snapshot && (
                <>
                  {' · '}Score: {Math.round(snapshot.finalScore)}
                </>
              )}
              {item.repeatedFromYesterday && (
                <> · Repeated ({item.repeatReason})</>
              )}
              {item.isReplacement && <> · Replaced by staff</>}
            </p>
            {snapshot && (
              <p className="mt-1.5 max-w-xl text-xs text-neutral-600">
                <span className="font-semibold text-neutral-700">
                  Why selected:{' '}
                </span>
                {snapshot.reason}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onReplace}
          className={`${buttonSecondaryClassName} shrink-0 px-2.5 py-1.5 text-xs`}
        >
          Replace
        </button>
      </div>
    </Card>
  )
}

function SellerPickSearch({
  shiftId,
  onPicked,
}: {
  shiftId: string
  onPicked: () => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [results, setResults] = useState<ProductPickerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(q: string) {
    setLoading(true)
    try {
      setResults(await searchProductsForPicker({ data: { q } }))
    } finally {
      setLoading(false)
    }
  }

  async function handlePick(productId: string) {
    setError(null)
    try {
      await setSellerPick({ data: { shiftId, productId } })
      onPicked()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="relative">
        <Search
          size={15}
          className="absolute top-2.5 left-2.5 text-neutral-400"
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            void handleSearch(e.target.value)
          }}
          placeholder="Search the catalog…"
          className={`${inputClassName} w-full pl-8`}
          autoFocus
        />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {loading && (
        <p className="mt-2 text-xs text-neutral-400">Searching…</p>
      )}
      {debouncedQuery && results.length > 0 && (
        <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => handlePick(p.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-50"
              >
                {p.image ? (
                  <img
                    src={p.image}
                    alt=""
                    className="size-8 rounded-md border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="size-8 rounded-md border border-neutral-200 bg-neutral-50" />
                )}
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReplaceItemDialog({
  itemId,
  onClose,
  onReplaced,
}: {
  itemId: string
  onClose: () => void
  onReplaced: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductPickerResult[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  )
  const [reason, setReason] = useState(REPLACEMENT_REASONS[0].value)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(q: string) {
    setResults(await searchProductsForPicker({ data: { q } }))
  }

  async function handleSubmit() {
    if (!selectedProductId) return
    setSubmitting(true)
    setError(null)
    try {
      await replaceBasketItem({
        data: {
          itemId,
          replacementProductId: selectedProductId,
          reason,
        },
      })
      onReplaced()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-neutral-900">
          Replace Product
        </h2>
        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-neutral-700">
          Replacement product
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              void handleSearch(e.target.value)
            }}
            placeholder="Search…"
            className={inputClassName}
            autoFocus
          />
        </label>
        {results.length > 0 && (
          <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-neutral-200">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedProductId(p.id)}
                  className={`w-full px-2 py-1.5 text-left text-sm hover:bg-neutral-50 ${
                    selectedProductId === p.id ? 'bg-neutral-100' : ''
                  }`}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-neutral-700">
          Reason
          <select
            value={reason}
            onChange={(e) =>
              setReason(e.target.value as LiveReplacementReason)
            }
            className={inputClassName}
          >
            {REPLACEMENT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={buttonSecondaryClassName}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedProductId || submitting}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Replacing…' : 'Replace'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FinalizeButton({ shiftId }: { shiftId: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFinalize() {
    setSubmitting(true)
    setError(null)
    try {
      await finalizeShift({ data: { shiftId } })
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleFinalize}
        disabled={submitting}
        className={`${buttonPrimaryClassName} gap-2`}
      >
        <Radio size={16} />
        {submitting ? 'Finalizing…' : 'Finalize LIVE Basket'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
