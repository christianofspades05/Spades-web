import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  createManualExpense,
  deleteManualExpense,
  getExpensesSummary,
} from '#/server/admin/expenses'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import {
  buttonDangerClassName,
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/analytics/expenses')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getExpensesSummary({ data: resolved })
  },
  component: ExpensesPage,
})

function SummaryCard({ label, cents }: { label: string; cents: number }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-neutral-900">
        {formatCentsAsPHP(cents)}
      </p>
    </Card>
  )
}

function ExpensesPage() {
  const summary = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()

  const [expenseDate, setExpenseDate] = useState(summary.range.to)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amountPesos, setAmountPesos] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleRangeChange(
    preset: (typeof DATE_RANGE_PRESETS)[number],
    custom?: { from: string; to: string },
  ) {
    navigate({
      search: (prev) => ({
        ...prev,
        range: preset,
        from: custom?.from,
        to: custom?.to,
      }),
    })
  }

  async function handleAddExpense(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(amountPesos)
    if (!category.trim() || !expenseDate || !amount || amount <= 0) {
      setError('Fill in date, category, and a positive amount.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createManualExpense({
        data: {
          expenseDate,
          category: category.trim(),
          description: description.trim() || undefined,
          amountPesos: amount,
        },
      })
      setCategory('')
      setDescription('')
      setAmountPesos('')
      router.invalidate()
    } catch {
      setError('Could not save that expense — try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return
    await deleteManualExpense({ data: { id } })
    router.invalidate()
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Expenses"
        subtitle="Ads spend, marketplace fees, and manual costs in one view."
        action={
          <DateRangePicker
            preset={search.range}
            from={search.from ?? resolveDateRange(search.range, {}).from}
            to={search.to ?? resolveDateRange(search.range, {}).to}
            onChange={handleRangeChange}
          />
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Ads spend" cents={summary.adsSpendCents} />
        <SummaryCard label="TikTok fees" cents={summary.tiktokFeeCents} />
        <SummaryCard label="Shopee fees" cents={summary.shopeeFeeCents} />
        <SummaryCard
          label="Manual expenses"
          cents={summary.manualExpensesCents}
        />
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Total</p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">
            {formatCentsAsPHP(summary.totalCents)}
          </p>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Add a manual expense
        </h2>
        <form
          onSubmit={handleAddExpense}
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end"
        >
          <label className={labelClassName}>
            Date
            <input
              type="date"
              className={inputClassName}
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
          </label>
          <label className={labelClassName}>
            Category
            <input
              type="text"
              placeholder="e.g. Packaging"
              className={inputClassName}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          <label className={`${labelClassName} sm:col-span-2`}>
            Description (optional)
            <input
              type="text"
              className={inputClassName}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className={labelClassName}>
            Amount (₱)
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClassName}
              value={amountPesos}
              onChange={(e) => setAmountPesos(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className={`${buttonPrimaryClassName} sm:col-span-5`}
          >
            {submitting ? 'Saving…' : 'Add expense'}
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Manual expenses
        </h2>
        <p className="text-xs text-neutral-500">
          Hand-entered costs in this date range.
        </p>

        {summary.manualExpenses.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">
            No manual expenses in this range.
          </p>
        ) : (
          <div className={`${tableWrapperClassName} mt-5`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Date</th>
                    <th className={tableHeadClassName}>Category</th>
                    <th className={tableHeadClassName}>Description</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Amount
                    </th>
                    <th className={tableHeadClassName} />
                  </tr>
                </thead>
                <tbody>
                  {summary.manualExpenses.map((expense) => (
                    <tr key={expense.id} className={tableRowClassName}>
                      <td className={tableCellClassName}>
                        {expense.expense_date}
                      </td>
                      <td className={tableCellClassName}>{expense.category}</td>
                      <td className={tableCellClassName}>
                        {expense.description || '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(expense.amount_cents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        <button
                          type="button"
                          className={buttonDangerClassName}
                          onClick={() => handleDelete(expense.id)}
                        >
                          Delete
                        </button>
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
