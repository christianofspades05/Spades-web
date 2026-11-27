import { useMemo, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  X,
} from 'lucide-react'
import {
  getAffiliateCreatorDetail,
  getAffiliatePerformance,
} from '#/server/admin/affiliates'
import type {
  AffiliateAlert,
  AffiliateDetail,
  AffiliateRow,
} from '#/server/admin/affiliates'
import {
  AFFILIATE_STATUS_LABELS,
  AFFILIATE_STATUS_RULES,
} from '#/lib/creators/affiliate-status'
import type { AffiliateStatus } from '#/lib/creators/affiliate-status'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { CreatorsTabs } from '#/components/admin/CreatorsTabs'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { CopyButton } from '#/components/admin/CopyButton'
import {
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/creators/analytics')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('this_month'),
    from: z.string().optional(),
    to: z.string().optional(),
    allTime: z.boolean().catch(false),
    tz: z.enum(['ph', 'la']).catch('ph'),
    /** Open detail drawer for this creator. */
    creator: z.string().uuid().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const range: { from?: string; to?: string } = deps.allTime
      ? {}
      : resolveDateRange(deps.range, { from: deps.from, to: deps.to })
    const [performance, detail] = await Promise.all([
      getAffiliatePerformance({ data: { ...range, tz: deps.tz } }),
      deps.creator
        ? getAffiliateCreatorDetail({
            data: { ...range, tz: deps.tz, creatorId: deps.creator },
          })
        : Promise.resolve(null),
    ])
    return { performance, detail, range }
  },
  component: AffiliatesPage,
})

const STATUS_CLASSES: Record<AffiliateStatus, string> = {
  scale: 'bg-emerald-100 text-emerald-700',
  test: 'bg-amber-100 text-amber-700',
  stop: 'bg-red-100 text-red-700',
  no_code: 'bg-orange-100 text-orange-700',
  idle: 'bg-neutral-100 text-neutral-500',
}

const STATUS_HELP: Record<AffiliateStatus, string> = {
  scale: `ROI ≥ ${AFFILIATE_STATUS_RULES.scaleMinRoi}× and ≥ ${AFFILIATE_STATUS_RULES.scaleMinOrders} orders — worth spending more on.`,
  test: `Gift/fee under ${AFFILIATE_STATUS_RULES.testGiftWithinDays} days ago, or not enough orders yet to judge.`,
  stop: `${AFFILIATE_STATUS_RULES.stopDaysSinceGift}+ days since the last gift/fee with 0 orders since, or losing money over the last ${AFFILIATE_STATUS_RULES.stopRoiWindowDays} days.`,
  no_code:
    'We spent on them but they have no active code, so sales can’t be tracked.',
  idle: 'No spend and no orders yet.',
}

const ALERT_CLASSES: Record<AffiliateAlert['kind'], string> = {
  no_code: 'border-orange-200 bg-orange-50 text-orange-800',
  no_orders_after_gift: 'border-red-200 bg-red-50 text-red-800',
  scale: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  payout_ready: 'border-blue-200 bg-blue-50 text-blue-800',
}

function StatusPill({ status }: { status: AffiliateStatus }) {
  return (
    <span
      title={STATUS_HELP[status]}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_CLASSES[status]}`}
    >
      {AFFILIATE_STATUS_LABELS[status]}
    </span>
  )
}

function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(0)}%`
}
function fmtRoi(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}×`
}
function fmtMoney(v: number | null): string {
  return v === null ? '—' : formatCentsAsPHP(v)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
      {initials(name)}
    </span>
  )
}

function SocialLinks({
  row,
}: {
  row: Pick<AffiliateRow, 'tiktokUrl' | 'instagramUrl' | 'facebookUrl'>
}) {
  const links = [
    ['TikTok', row.tiktokUrl],
    ['IG', row.instagramUrl],
    ['FB', row.facebookUrl],
  ].filter((l): l is [string, string] => Boolean(l[1]))
  if (links.length === 0) return null
  return (
    <span className="flex gap-2 text-xs">
      {links.map(([label, url]) => (
        <a
          key={label}
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          {label}
        </a>
      ))}
    </span>
  )
}

function CodeList({ row }: { row: AffiliateRow }) {
  if (row.codes.length === 0) {
    return (
      <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
        No code
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {row.codes.map((c) => (
        <span key={c.code} className="flex items-center gap-1">
          <span className="font-mono text-xs">{c.code}</span>
          <span onClick={(e) => e.stopPropagation()}>
            <CopyButton value={c.link} label="Copy link" iconOnly />
          </span>
        </span>
      ))}
    </div>
  )
}

type SortKey =
  | 'name'
  | 'status'
  | 'spentCents'
  | 'giftsCents'
  | 'linkClicks'
  | 'orders'
  | 'cancelReturnPct'
  | 'netSalesCents'
  | 'profitCents'
  | 'roi'
  | 'costPerOrderCents'
  | 'aovCents'
  | 'newCustomerPct'
  | 'lastOrderAt'
  | 'daysSinceLastGift'
  | 'commissionOwedCents'

const STATUS_ORDER: Record<AffiliateStatus, number> = {
  scale: 0,
  test: 1,
  no_code: 2,
  stop: 3,
  idle: 4,
}

function sortValue(row: AffiliateRow, key: SortKey): number | string | null {
  if (key === 'status') return STATUS_ORDER[row.status]
  if (key === 'name') return row.name.toLowerCase()
  if (key === 'lastOrderAt')
    return row.lastOrderAt ? new Date(row.lastOrderAt).getTime() : null
  return row[key]
}

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Creator' },
  { key: 'status', label: 'Status' },
  { key: 'spentCents', label: 'Spent', align: 'right' },
  { key: 'giftsCents', label: 'Gifts / Fees', align: 'right' },
  { key: 'linkClicks', label: 'Link clicks', align: 'right' },
  { key: 'orders', label: 'Orders', align: 'right' },
  { key: 'cancelReturnPct', label: 'Cancel / return', align: 'right' },
  { key: 'netSalesCents', label: 'Net sales', align: 'right' },
  { key: 'profitCents', label: 'Profit', align: 'right' },
  { key: 'roi', label: 'ROI', align: 'right' },
  { key: 'costPerOrderCents', label: 'Cost / order', align: 'right' },
  { key: 'aovCents', label: 'AOV', align: 'right' },
  { key: 'newCustomerPct', label: 'New cust.', align: 'right' },
  { key: 'lastOrderAt', label: 'Last order', align: 'right' },
  { key: 'daysSinceLastGift', label: 'Since gift', align: 'right' },
  { key: 'commissionOwedCents', label: 'Commission owed', align: 'right' },
]

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(rows: AffiliateRow[], label: string) {
  const pesos = (c: number | null) => (c === null ? null : (c / 100).toFixed(2))
  const header = [
    'Creator',
    'Codes',
    'Status',
    'Spent',
    'Gifts',
    'Content fees',
    'Other expenses',
    'Commission earned',
    'Link clicks',
    'Orders',
    'Code orders',
    'Link orders',
    'Cancel/return %',
    'Net sales',
    'COGS',
    'Profit',
    'ROI',
    'Cost per order',
    'AOV',
    'New customers %',
    'Last order',
    'Days since last gift',
    'Orders since last gift',
    'Commission owed',
    'Commission eligible',
    'Commission on hold',
  ]
  const lines = rows.map((r) =>
    [
      r.name,
      r.codes.map((c) => c.code).join(' '),
      AFFILIATE_STATUS_LABELS[r.status],
      pesos(r.spentCents),
      pesos(r.giftsCents),
      pesos(r.feesCents),
      pesos(r.otherExpensesCents),
      pesos(r.commissionEarnedCents),
      r.linkClicks,
      r.orders,
      r.codeOrders,
      r.linkOrders,
      r.cancelReturnPct?.toFixed(1) ?? null,
      pesos(r.netSalesCents),
      pesos(r.cogsCents),
      pesos(r.profitCents),
      r.roi?.toFixed(2) ?? null,
      pesos(r.costPerOrderCents),
      pesos(r.aovCents),
      r.newCustomerPct?.toFixed(1) ?? null,
      r.lastOrderAt ? r.lastOrderAt.slice(0, 10) : null,
      r.daysSinceLastGift,
      r.ordersSinceLastGift,
      pesos(r.commissionOwedCents),
      pesos(r.commissionEligibleCents),
      pesos(r.commissionOnHoldCents),
    ]
      .map(csvCell)
      .join(','),
  )
  const blob = new Blob([[header.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `affiliates-${label}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function AffiliatesPage() {
  const { performance, detail, range } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [sortKey, setSortKey] = useState<SortKey>('profitCents')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rows = useMemo(() => {
    const sorted = [...performance.rows].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      if (av === bv) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [performance.rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'status' ? 'asc' : 'desc')
    }
  }

  function handleRangeChange(
    preset: DateRangePreset,
    custom?: { from: string; to: string },
  ) {
    navigate({
      search: (prev) => ({
        ...prev,
        allTime: false,
        range: preset,
        from: custom?.from,
        to: custom?.to,
      }),
    })
  }

  function openCreator(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, creator: id }) })
  }

  const s = performance.summary
  const rangeBounds =
    range.from && range.to ? { from: range.from, to: range.to } : null
  const rangeLabel = rangeBounds
    ? `${rangeBounds.from}_to_${rangeBounds.to}`
    : 'all-time'

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Creators & Affiliates"
        subtitle="Is each creator worth what we spend on them?"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              preset={search.range}
              from={search.from ?? resolveDateRange(search.range, {}).from}
              to={search.to ?? resolveDateRange(search.range, {}).to}
              onChange={handleRangeChange}
            />
            <button
              type="button"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, allTime: !prev.allTime }),
                })
              }
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                search.allTime
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              All time
            </button>
            <select
              value={search.tz}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    tz: e.target.value as 'ph' | 'la',
                  }),
                })
              }
              className={inputClassName}
              title="Timezone this report's dates are grouped by"
            >
              <option value="ph">Philippine Time</option>
              <option value="la">Los Angeles, America</option>
            </select>
            <button
              type="button"
              onClick={() => downloadCsv(rows, rangeLabel)}
              className={buttonSecondaryClassName}
            >
              <Download className="mr-1.5 size-4" />
              Export CSV
            </button>
          </div>
        }
      />
      <CreatorsTabs active="analytics" />

      {search.allTime && (
        <p className="-mt-3 mb-4 text-xs text-neutral-500">
          Showing all time — the date range above is ignored.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-4 sm:p-5">
          <p className="text-xs text-neutral-500">Total spent on creators</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(s.spentCents)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Gifts {formatCentsAsPHP(s.giftsCents)} · Fees{' '}
            {formatCentsAsPHP(s.feesCents + s.otherExpensesCents)} · Commission{' '}
            {formatCentsAsPHP(s.commissionEarnedCents)}
          </p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs text-neutral-500">Creator orders · net sales</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {s.orders} · {formatCentsAsPHP(s.netSalesCents)}
          </p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs text-neutral-500">Creator profit · ROI</p>
          <p
            className={`mt-1 text-xl font-semibold ${s.profitCents >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {formatCentsAsPHP(s.profitCents)} · {fmtRoi(s.roi)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            After COGS, fees, commission and gifts
          </p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-xs text-neutral-500">Creators</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {s.activeCreators} active · {s.creatorsWithOrders} with orders
          </p>
          {s.creatorsWithoutCode > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-orange-600">
              <AlertTriangle className="size-3.5" />
              {s.creatorsWithoutCode} with no code
            </p>
          )}
        </Card>
      </div>

      {performance.alerts.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {performance.alerts.map((alert, i) => (
            <button
              key={`${alert.kind}-${alert.creatorId}-${i}`}
              type="button"
              onClick={() => openCreator(alert.creatorId)}
              className={`rounded-lg border px-3 py-2 text-left text-sm ${ALERT_CLASSES[alert.kind]}`}
            >
              {alert.message}
            </button>
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-900">
        Creator leaderboard
      </h2>

      {rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-500">No creators yet.</p>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 md:hidden">
            <select
              value={sortKey}
              onChange={(e) => toggleSort(e.target.value as SortKey)}
              className={`${inputClassName} flex-1`}
            >
              {COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>
                  Sort: {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              className={buttonSecondaryClassName}
              aria-label="Flip sort direction"
            >
              {sortDir === 'asc' ? (
                <ArrowUp className="size-4" />
              ) : (
                <ArrowDown className="size-4" />
              )}
            </button>
          </div>
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => (
              <Card
                key={r.creatorId}
                className="cursor-pointer p-4"
                onClick={() => openCreator(r.creatorId)}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-neutral-900">
                      {r.name}
                    </p>
                    <SocialLinks row={r} />
                  </div>
                  <StatusPill status={r.status} />
                </div>
                <div className="mt-2">
                  <CodeList row={r} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-neutral-500">Spent</p>
                    <p className="font-medium">
                      {formatCentsAsPHP(r.spentCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Orders</p>
                    <p className="font-medium">{r.orders}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Net sales</p>
                    <p className="font-medium">
                      {formatCentsAsPHP(r.netSalesCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Profit</p>
                    <p
                      className={`font-medium ${r.profitCents >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                    >
                      {formatCentsAsPHP(r.profitCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">ROI</p>
                    <p className="font-medium">{fmtRoi(r.roi)}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Owed</p>
                    <p className="font-medium">
                      {formatCentsAsPHP(r.commissionOwedCents)}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  {r.daysSinceLastGift !== null
                    ? `Last gift ${r.daysSinceLastGift}d ago · ${r.ordersSinceLastGift} orders since`
                    : 'No gifts yet'}
                  {' · '}
                  {r.linkClicks} link clicks
                </p>
              </Card>
            ))}
          </div>

          <div className={`${tableWrapperClassName} hidden md:block`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px]">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={`${tableHeadClassName} cursor-pointer whitespace-nowrap select-none ${c.align === 'right' ? 'text-right' : ''}`}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label}
                        {sortKey === c.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.creatorId}
                      className={`${tableRowClassName} cursor-pointer`}
                      onClick={() => openCreator(r.creatorId)}
                    >
                      <td className={tableCellClassName}>
                        <div className="flex items-start gap-2.5">
                          <Avatar name={r.name} />
                          <div>
                            <p className="font-medium whitespace-nowrap">
                              {r.name}
                            </p>
                            <SocialLinks row={r} />
                            <div className="mt-1">
                              <CodeList row={r} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={tableCellClassName}>
                        <StatusPill status={r.status} />
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(r.spentCents)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right text-xs whitespace-nowrap text-neutral-600`}
                      >
                        {formatCentsAsPHP(r.giftsCents)} /{' '}
                        {formatCentsAsPHP(r.feesCents + r.otherExpensesCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {r.linkClicks}
                        {r.clickToOrderPct !== null && (
                          <span className="block text-xs text-neutral-500">
                            {fmtPct(r.clickToOrderPct)} → order
                          </span>
                        )}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {r.orders}
                        {r.linkOrders > 0 && (
                          <span className="block text-xs text-neutral-500">
                            {r.codeOrders} code · {r.linkOrders} link
                          </span>
                        )}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {fmtPct(r.cancelReturnPct)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(r.netSalesCents)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right font-medium ${r.profitCents >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                      >
                        {formatCentsAsPHP(r.profitCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {fmtRoi(r.roi)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {fmtMoney(r.costPerOrderCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {fmtMoney(r.aovCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {fmtPct(r.newCustomerPct)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right whitespace-nowrap`}
                      >
                        {fmtDate(r.lastOrderAt)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right whitespace-nowrap`}
                      >
                        {r.daysSinceLastGift === null ? (
                          '—'
                        ) : (
                          <>
                            {r.daysSinceLastGift}d
                            <span className="block text-xs text-neutral-500">
                              {r.ordersSinceLastGift} orders since
                            </span>
                          </>
                        )}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right whitespace-nowrap`}
                      >
                        {formatCentsAsPHP(r.commissionOwedCents)}
                        {r.commissionOwedCents > 0 && (
                          <span className="block text-xs text-neutral-500">
                            {formatCentsAsPHP(r.commissionEligibleCents)} ready
                            · {formatCentsAsPHP(r.commissionOnHoldCents)} on
                            hold
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Spent = gifts + fees + other + commission earned. Profit = net sales
            + shipping − COGS − platform fees (same as the Profit page) −
            commission − gifts/fees. ROI = profit ÷ spent. Orders exclude
            cancelled and returned ones.
          </p>
        </>
      )}

      {search.creator && (
        <CreatorDrawer
          detail={detail}
          row={performance.rows.find((r) => r.creatorId === search.creator)}
          range={rangeBounds}
          onClose={() => openCreator(undefined)}
        />
      )}
    </div>
  )
}

const EXPENSE_KIND_LABELS = {
  gift: 'Gift',
  content_fee: 'Content fee',
  other: 'Other',
} as const

const RATE_LABELS = { normal: 'Normal', sale: 'Sale-day', mixed: 'Mixed' }

function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end && days.length < 731) {
    days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

function CreatorDrawer({
  detail,
  row,
  range,
  onClose,
}: {
  detail: AffiliateDetail | null
  row: AffiliateRow | undefined
  range: { from: string; to: string } | null
  onClose: () => void
}) {
  const chart = useMemo(() => {
    if (!detail) return []
    const byDay = new Map(detail.daily.map((d) => [d.date, d]))
    const clicks = new Map(detail.clicksDaily.map((d) => [d.date, d.clicks]))
    const known = [
      ...detail.daily.map((d) => d.date),
      ...detail.clicksDaily.map((d) => d.date),
    ].sort()
    const from = range?.from ?? known[0]
    const to = range?.to ?? new Date().toISOString().slice(0, 10)
    if (!from) return []
    return eachDay(from, to).map((date) => ({
      date,
      orders: byDay.get(date)?.orders ?? 0,
      sales: (byDay.get(date)?.netSalesCents ?? 0) / 100,
      clicks: clicks.get(date) ?? 0,
    }))
  }, [detail, range])

  const markers = useMemo(() => {
    if (!detail || chart.length === 0) return []
    const first = chart[0].date
    const last = chart[chart.length - 1].date
    return detail.expenses.filter((e) => e.date >= first && e.date <= last)
  }, [detail, chart])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-neutral-50 shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {detail?.creator && <Avatar name={detail.creator.name} />}
            <div className="min-w-0">
              <p className="truncate font-semibold text-neutral-900">
                {detail?.creator?.name ?? 'Creator'}
              </p>
              {row && (
                <div className="flex items-center gap-2">
                  <StatusPill status={row.status} />
                  <SocialLinks row={row} />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {detail?.creator && (
              <Link
                to="/admin/creators/$creatorId"
                params={{ creatorId: detail.creator.id }}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                Manage <ExternalLink className="size-3.5" />
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {!detail ? (
          <p className="p-6 text-sm text-neutral-500">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4 p-4 sm:p-6">
            {row && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat
                  label="Spent"
                  value={formatCentsAsPHP(row.spentCents)}
                />
                <MiniStat
                  label="Net sales"
                  value={formatCentsAsPHP(row.netSalesCents)}
                />
                <MiniStat
                  label="Profit"
                  value={formatCentsAsPHP(row.profitCents)}
                  tone={row.profitCents >= 0 ? 'good' : 'bad'}
                />
                <MiniStat label="ROI" value={fmtRoi(row.roi)} />
              </div>
            )}

            {row && row.codes.length > 0 && (
              <Card className="p-4">
                <h3 className="text-sm font-semibold">Tracking links</h3>
                <div className="mt-2 flex flex-col gap-1.5">
                  {row.codes.map((c) => (
                    <div
                      key={c.code}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate font-mono text-neutral-700">
                        {c.link}
                      </span>
                      <CopyButton value={c.link} label="Copy link" />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  {row.linkClicks} clicks · {row.codeOrders} code orders ·{' '}
                  {row.linkOrders} link orders
                  {row.clickToOrderPct !== null &&
                    ` · ${fmtPct(row.clickToOrderPct)} click → order`}
                </p>
              </Card>
            )}

            <Card className="p-4">
              <h3 className="text-sm font-semibold">Orders and sales by day</h3>
              <p className="text-xs text-neutral-500">
                Dashed lines mark gifts (green) and fees (purple).
              </p>
              {chart.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">
                  No activity yet.
                </p>
              ) : (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ left: 0, right: 8 }}>
                      <CartesianGrid stroke="#f0f0f0" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(d: string) => d.slice(5)}
                        minTickGap={20}
                      />
                      <YAxis
                        yAxisId="o"
                        allowDecimals={false}
                        tick={{ fontSize: 10 }}
                        width={24}
                      />
                      <YAxis
                        yAxisId="s"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        width={44}
                        tickFormatter={(v: number) =>
                          `₱${Math.round(v / 1000)}k`
                        }
                      />
                      <Tooltip
                        formatter={(value, name) =>
                          name === 'Net sales'
                            ? `₱${Number(value).toLocaleString('en-PH')}`
                            : value
                        }
                      />
                      <Bar
                        yAxisId="o"
                        dataKey="orders"
                        name="Orders"
                        fill="#171717"
                      />
                      <Line
                        yAxisId="s"
                        dataKey="sales"
                        name="Net sales"
                        stroke="#2c6ecb"
                        dot={false}
                        strokeWidth={2}
                      />
                      {markers.map((m) => (
                        <ReferenceLine
                          key={m.id}
                          yAxisId="o"
                          x={m.date}
                          stroke={m.kind === 'gift' ? '#059669' : '#7c3aed'}
                          strokeDasharray="4 3"
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold">
                Gifts, fees and their effect
              </h3>
              <p className="text-xs text-neutral-500">
                All time. Orders in the 14 days before vs after each one.
              </p>
              {detail.expenses.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">No expenses.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr>
                        <th className={tableHeadClassName}>Date</th>
                        <th className={tableHeadClassName}>What</th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Qty
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Cost
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Orders before → after
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.expenses.map((e) => (
                        <tr key={e.id} className={tableRowClassName}>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {e.date}
                          </td>
                          <td className="px-4 py-2">
                            <span className="text-xs text-neutral-500">
                              {EXPENSE_KIND_LABELS[e.kind]}
                            </span>
                            <p>
                              {e.productName
                                ? `${e.productName}${e.variantLabel ? ` (${e.variantLabel})` : ''}`
                                : e.description}
                            </p>
                          </td>
                          <td className="px-4 py-2 text-right">
                            {e.quantity ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {formatCentsAsPHP(e.amountCents)}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {e.ordersBefore14d} → {e.ordersAfter14d}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold">Orders</h3>
              <p className="text-xs text-neutral-500">In the selected range.</p>
              {detail.orders.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">No orders.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr>
                        <th className={tableHeadClassName}>Order</th>
                        <th className={tableHeadClassName}>Status</th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Net sales
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Profit
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Commission
                        </th>
                        <th className={tableHeadClassName}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.orders.map((o) => (
                        <tr
                          key={o.orderId}
                          className={`${tableRowClassName} ${o.isCancelOrReturn ? 'text-neutral-400' : ''}`}
                        >
                          <td className="px-4 py-2 whitespace-nowrap">
                            <Link
                              to="/admin/orders/$orderId"
                              params={{ orderId: o.orderId }}
                              className="font-medium hover:underline"
                            >
                              {o.orderNumber}
                            </Link>
                            <span className="block text-xs text-neutral-500">
                              {fmtDate(o.placedAt)}
                              {o.attributionType === 'link'
                                ? ' · via link'
                                : ''}
                              {o.isNewCustomer ? ' · new' : ''}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {o.status.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {formatCentsAsPHP(o.netSalesCents)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {formatCentsAsPHP(o.profitCents)}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {formatCentsAsPHP(o.commissionCents)}
                            <span className="block text-xs text-neutral-500">
                              {o.commissionStatus.toLowerCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {RATE_LABELS[o.rateKind]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="p-4">
                <h3 className="text-sm font-semibold">
                  Top products with their code
                </h3>
                {detail.topProducts.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-500">None yet.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                    {detail.topProducts.map((p) => (
                      <li
                        key={p.productName}
                        className="flex justify-between gap-2"
                      >
                        <span className="truncate">
                          {p.quantity}× {p.productName}
                        </span>
                        <span className="shrink-0 text-neutral-500">
                          {formatCentsAsPHP(p.netSalesCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold">Payouts</h3>
                {row && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Owed {formatCentsAsPHP(row.commissionOwedCents)} —{' '}
                    {formatCentsAsPHP(row.commissionEligibleCents)} ready,{' '}
                    {formatCentsAsPHP(row.commissionOnHoldCents)} on hold
                  </p>
                )}
                {detail.payouts.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-500">
                    No payouts yet.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                    {detail.payouts.map((p) => (
                      <li key={p.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {fmtDate(p.createdAt)} · {p.reference}
                        </span>
                        <span className="shrink-0">
                          {formatCentsAsPHP(p.amountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card className="p-4">
              <h3 className="text-sm font-semibold">Notes</h3>
              <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-700">
                {detail.creator?.notes || 'No notes.'}
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  return (
    <Card className="p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p
        className={`mt-0.5 font-semibold ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-neutral-900'}`}
      >
        {value}
      </p>
    </Card>
  )
}
