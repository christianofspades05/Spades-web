import { creatorTotals } from '#/lib/creators/totals'
import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  creatorCommand,
  getCreator,
  searchGiftVariants,
} from '#/server/admin/creators'
import { CreatorProfileForm } from '#/components/admin/CreatorProfileForm'
import { PageHeader } from '#/components/admin/PageHeader'
import { formatCentsAsPHP as money } from '#/lib/utils/money'
import {
  buttonPrimaryClassName as primary,
  buttonSecondaryClassName as secondary,
  inputClassName as input,
  tableWrapperClassName,
  tableCellClassName as cell,
  tableHeadClassName as head,
} from '#/components/admin/ui'
import type { CreatorCommand } from '#/lib/validation/admin/creators'

export const Route = createFileRoute('/admin/creators/$creatorId')({
  loader: ({ params }) => getCreator({ data: { id: params.creatorId } }),
  component: CreatorPage,
})
function CreatorPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [tab, setTab] = useState('Overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const creatorId = data.creator.id
  async function run(command: CreatorCommand) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await creatorCommand({ data: command })
      await router.invalidate()
      setNotice('Saved')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save')
      return false
    } finally {
      setBusy(false)
    }
  }
  const inRange = (at: string) => {
    const day = new Date(at).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Manila',
    })
    return (!from || day >= from) && (!to || day <= to)
  }
  const orders = data.orders.filter((o) => inRange(o.created_at))
  const expenses = data.expenses.filter((e) => inRange(e.incurred_at))
  const totals = creatorTotals(orders, expenses)
  const filtered = orders.filter((o) => status === 'ALL' || o.status === status)
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <Link
        to="/admin/creators"
        className="mb-3 inline-block text-sm text-neutral-500"
      >
        ← Creators
      </Link>
      <PageHeader
        title={data.creator.name}
        subtitle={
          data.creator.is_active
            ? 'Active creator · PHP accounting'
            : 'Archived creator'
        }
        action={
          <button
            disabled={busy}
            className={secondary}
            onClick={() => run({ action: 'reconcile', creatorId })}
          >
            Recheck commissions
          </button>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {['Overview', 'Codes', 'Expenses & Gifts', 'Payouts', 'Profile'].map(
          (name) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className={tab === name ? primary : secondary}
            >
              {name}
            </button>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm text-green-700">
          {notice}
        </p>
      )}
      {tab === 'Profile' && (
        <CreatorProfileForm
          creator={data.creator}
          onSaved={async () => {
            await router.invalidate()
          }}
        />
      )}
      {tab === 'Overview' && (
        <>
          <div className="mb-4 flex flex-wrap gap-3 text-sm">
            <label>
              From (Manila)
              <input
                type="date"
                className={input}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setPage(0)
                }}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                className={input}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setPage(0)
                }}
              />
            </label>
          </div>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Retained product sales', money(totals.sales)],
              ['Finalized product sales', money(totals.finalizedSales)],
              ['Pending commission', money(totals.pending)],
              ['Approved commission', money(totals.approved)],
              ['Settled commission', money(totals.paid)],
              ['Recovery balance', money(totals.recovery)],
              ['Content, gifts & expenses', money(totals.expenseTotal)],
              [
                'Product contribution',
                totals.missingCosts
                  ? 'Cost incomplete'
                  : money(totals.contribution),
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-white p-4">
                <p className="text-xs text-neutral-500">{label}</p>
                <p className="mt-2 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <p className="mb-5 text-xs text-neutral-500">
            Pending revenue is provisional. Contribution deducts snapshotted
            COGS, commissions and recorded expenses; shipping and gateway costs
            are excluded. Sales use the order cohort; expenses use their
            incurred date. Recheck updates elapsed hold periods. Default hold:
            14 days after delivery.
          </p>
          <select
            aria-label="Commission status"
            className={`${input} mb-3 max-w-xs`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(0)
            }}
          >
            {['ALL', 'PENDING', 'APPROVED', 'PAID', 'REVERSED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className={tableWrapperClassName}>
            <table className="w-full">
              <thead>
                <tr>
                  {[
                    'Order / code',
                    'Product sales',
                    'Commission',
                    'Settled',
                    'Status / eligibility',
                    '',
                  ].map((h) => (
                    <th key={h} className={head}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 25, (page + 1) * 25).map((o) => (
                  <tr key={o.order_id}>
                    <td className={cell}>
                      <Link
                        className="underline"
                        to="/admin/orders/$orderId"
                        params={{ orderId: o.order_id }}
                      >
                        {o.order_id.slice(0, 8)}
                      </Link>
                      <div className="text-xs text-neutral-500">
                        {o.code_snapshot} · {o.commission_bps / 100}%
                      </div>
                    </td>
                    <td className={cell}>{money(o.product_revenue_cents)}</td>
                    <td className={cell}>{money(o.earned_cents)}</td>
                    <td className={cell}>{money(o.paid_cents)}</td>
                    <td className={cell}>
                      <span className="text-xs font-semibold">{o.status}</span>
                      {o.hold_reasons.map((reason) => (
                        <p key={reason} className="text-xs text-amber-700">
                          {reason}
                        </p>
                      ))}
                      {o.eligible_at && (
                        <p className="text-xs text-neutral-500">
                          Eligible{' '}
                          {new Date(o.eligible_at).toLocaleDateString()}
                        </p>
                      )}
                    </td>
                    <td className={cell}>
                      {data.canPay && o.status === 'PENDING' && (
                        <button
                          className={secondary}
                          disabled={
                            busy ||
                            o.hold_reasons.length > 0 ||
                            o.earned_cents <= o.paid_cents
                          }
                          onClick={() =>
                            run({ action: 'approve', orderId: o.order_id })
                          }
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="p-6 text-neutral-500">
                No attributed orders in this period.
              </p>
            )}
          </div>
          <div className="my-4 flex gap-4 text-sm">
            <button disabled={!page} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <button
              disabled={(page + 1) * 25 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {tab === 'Codes' && (
        <>
          <p className="mb-4 text-sm text-neutral-600">
            Assign an existing code or{' '}
            <Link to="/admin/discounts/new" className="underline">
              create a discount
            </Link>
            . Rate and hold changes apply to future checkouts only. Code
            ownership cannot be transferred.
          </p>
          <CodeForm
            key="new"
            discounts={data.discounts}
            creatorId={creatorId}
            run={run}
            busy={busy}
          />
          {data.assignments.map((a) => (
            <CodeForm
              key={a.id}
              assignment={a}
              discounts={data.discounts}
              creatorId={creatorId}
              run={run}
              busy={busy}
            />
          ))}
        </>
      )}
      {tab === 'Expenses & Gifts' && (
        <>
          <ExpenseForm creatorId={creatorId} run={run} busy={busy} />
          <div className={`${tableWrapperClassName} mt-6`}>
            <table className="w-full">
              <thead>
                <tr>
                  {['Date', 'Description', 'Kind', 'Cost', 'Payment'].map(
                    (h) => (
                      <th key={h} className={head}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((e) => (
                  <tr key={e.id}>
                    <td className={cell}>
                      {new Date(e.incurred_at).toLocaleDateString()}
                    </td>
                    <td className={cell}>
                      {e.description}
                      {e.quantity && ` · ${e.quantity} units`}
                    </td>
                    <td className={cell}>{e.kind}</td>
                    <td className={cell}>{money(e.amount_cents)}</td>
                    <td className={cell}>
                      {e.paid_at ? (
                        'Paid'
                      ) : e.kind === 'gift' ? (
                        'Stock issued'
                      ) : (
                        <button
                          className={secondary}
                          disabled={busy}
                          onClick={() =>
                            run({
                              action: 'expense_paid',
                              creatorId,
                              expenseId: e.id,
                            })
                          }
                        >
                          Record as paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === 'Payouts' && (
        <>
          <div className="mb-5 rounded-lg border bg-white p-5">
            <p>
              Approved {money(data.totals.approved)} − recovery{' '}
              {money(data.totals.recovery)} ={' '}
              <strong>{money(data.totals.payable)} payable</strong>
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              All-time balance. Record a payment already made using its unique
              bank or wallet reference. Reversals remain in history and are
              offset against the next payout.
            </p>
            {data.canPay && (
              <form
                className="mt-4 flex flex-wrap gap-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = e.currentTarget
                  const reference = String(new FormData(form).get('reference'))
                  if (
                    await run({
                      action: 'payout',
                      creatorId,
                      reference,
                      expectedAmountCents: data.totals.payable,
                    })
                  )
                    form.reset()
                }}
              >
                <input
                  name="reference"
                  aria-label="Payment reference"
                  required
                  maxLength={200}
                  className={input}
                  placeholder="Bank / wallet payment reference"
                />
                <button
                  disabled={busy || data.totals.payable <= 0}
                  className={primary}
                >
                  Record payment of {money(data.totals.payable)}
                </button>
              </form>
            )}
          </div>
          <div className={tableWrapperClassName}>
            <table className="w-full">
              <thead>
                <tr>
                  {['Recorded', 'Reference', 'Amount'].map((h) => (
                    <th className={head} key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className={cell}>
                      {new Date(p.created_at).toLocaleString()}
                    </td>
                    <td className={cell}>{p.reference}</td>
                    <td className={cell}>{money(p.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

type Run = (command: CreatorCommand) => Promise<boolean>
type Detail = Awaited<ReturnType<typeof getCreator>>
function CodeForm({
  assignment,
  discounts,
  creatorId,
  run,
  busy,
}: {
  assignment?: Detail['assignments'][number]
  discounts: Detail['discounts']
  creatorId: string
  run: Run
  busy: boolean
}) {
  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        void run({
          action: 'assign_code',
          creatorId,
          discountId: assignment?.discount_id ?? String(f.get('discount')),
          commissionBps: Math.round(Number(f.get('rate')) * 100),
          holdDays: Number(f.get('hold')),
          brand:
            assignment?.brand === 'ysrael'
              ? 'ysrael'
              : assignment?.brand === 'aspire365'
                ? 'aspire365'
                : 'spades',
          isActive: f.get('active') === 'on',
        })
      }}
    >
      <label className="text-sm">
        Discount code
        <select
          name="discount"
          required
          disabled={!!assignment}
          defaultValue={assignment?.discount_id ?? ''}
          className={input}
        >
          <option value="">Choose code</option>
          {discounts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} ·{' '}
              {d.type === 'percentage' ? `${d.value}%` : money(d.value)} off
              {!d.is_active ? ' (inactive)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Creator commission %
        <input
          name="rate"
          type="number"
          min="0"
          max="100"
          step="0.01"
          required
          defaultValue={assignment ? assignment.commission_bps / 100 : 8}
          className={input}
        />
      </label>
      <label className="text-sm">
        Hold after delivery (days)
        <input
          name="hold"
          type="number"
          min="0"
          max="365"
          required
          defaultValue={assignment?.hold_days ?? 14}
          className={input}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="active"
          type="checkbox"
          defaultChecked={assignment?.is_active ?? true}
        />
        Accept new attributions
      </label>
      <span className="self-center text-xs text-neutral-500">
        {assignment?.brand ?? 'spades'} storefront
      </span>
      <div className="flex items-center sm:col-span-3">
        <button className={primary} disabled={busy}>
          {busy ? 'Saving…' : assignment ? 'Save' : 'Assign code'}
        </button>
      </div>
    </form>
  )
}
function ExpenseForm({
  creatorId,
  run,
  busy,
}: {
  creatorId: string
  run: Run
  busy: boolean
}) {
  const [kind, setKind] = useState<'content_fee' | 'gift' | 'other'>(
    'content_fee',
  )
  const [giftQuery, setGiftQuery] = useState('')
  const [variants, setVariants] = useState<
    Awaited<ReturnType<typeof searchGiftVariants>>
  >([])
  const [error, setError] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  return (
    <form
      className="grid gap-4 rounded-lg border bg-white p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const form = e.currentTarget
        const f = new FormData(form)
        const id = requestId ?? crypto.randomUUID()
        setRequestId(id)
        const ok = await run({
          action: 'expense',
          id,
          creatorId,
          kind,
          description: String(f.get('description')),
          amountCents:
            kind === 'gift' ? 0 : Math.round(Number(f.get('amount')) * 100),
          variantId: kind === 'gift' ? String(f.get('variant')) : undefined,
          quantity: kind === 'gift' ? Number(f.get('quantity')) : undefined,
          incurredAt: new Date(
            String(f.get('date')) + 'T00:00:00+08:00',
          ).toISOString(),
          paidAt: f.get('paid') === 'on' ? new Date().toISOString() : null,
        })
        if (ok) {
          form.reset()
          setRequestId(null)
        }
      }}
    >
      <label className="text-sm">
        Expense type
        <select
          className={input}
          value={kind}
          onChange={(e) => {
            if (
              e.target.value === 'gift' ||
              e.target.value === 'content_fee' ||
              e.target.value === 'other'
            )
              setKind(e.target.value)
          }}
        >
          <option value="content_fee">Fixed content fee</option>
          <option value="gift">Gifted products</option>
          <option value="other">Other creator cost</option>
        </select>
      </label>
      <label className="text-sm">
        Incurred date
        <input
          name="date"
          type="date"
          required
          defaultValue={new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Manila',
          })}
          className={input}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        Description / campaign
        <input name="description" required maxLength={1000} className={input} />
      </label>
      {kind !== 'gift' ? (
        <label className="text-sm">
          Amount (PHP)
          <input
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            className={input}
          />
        </label>
      ) : (
        <>
          <div className="sm:col-span-2">
            <label className="text-sm">
              Search products
              <input
                value={giftQuery}
                onChange={(e) => setGiftQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault()
                }}
                placeholder="Product name or SKU"
                className={input}
              />
            </label>
            <button
              type="button"
              className={`${secondary} mt-2`}
              onClick={async () => {
                try {
                  setVariants(
                    await searchGiftVariants({ data: { q: giftQuery } }),
                  )
                  setError('')
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Search failed')
                }
              }}
            >
              Find variants
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
          <label className="text-sm">
            Variant
            <select name="variant" required className={input}>
              <option value="">Choose variant</option>
              {variants.map((v) => (
                <option
                  key={v.id}
                  value={v.id}
                  disabled={v.cost_cents === null}
                >
                  {v.productName ?? 'Unknown product'} · {v.sku} · {v.size} ·{' '}
                  {v.cost_cents === null ? 'Cost missing' : money(v.cost_cents)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Quantity
            <input
              name="quantity"
              type="number"
              min="1"
              max="10000"
              defaultValue="1"
              required
              className={input}
            />
          </label>
          <p className="text-xs text-neutral-500 sm:col-span-2">
            Recording a gift issues available stock and snapshots its cost.
            Gifted items do not create sales or commission.
          </p>
        </>
      )}
      {kind !== 'gift' && (
        <label className="flex items-center gap-2 text-sm">
          <input name="paid" type="checkbox" />
          Already paid
        </label>
      )}
      <button disabled={busy} className={primary}>
        Record {kind === 'gift' ? 'gift and issue stock' : 'expense'}
      </button>
    </form>
  )
}
