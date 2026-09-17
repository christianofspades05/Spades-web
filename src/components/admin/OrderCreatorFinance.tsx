import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { creatorCommand, getOrderCreatorFinance } from '#/server/admin/creators'
import type { CreatorCommand } from '#/lib/validation/admin/creators'
import { formatCentsAsPHP as money } from '#/lib/utils/money'
import {
  buttonPrimaryClassName as primary,
  buttonSecondaryClassName as secondary,
  inputClassName as input,
} from './ui'

/** Loaded on demand; staff without finance access never request this endpoint. */
export function OrderCreatorFinance({
  orderId,
  isCod,
  role,
}: {
  orderId: string
  isCod: boolean
  role: string
}) {
  const router = useRouter()
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getOrderCreatorFinance>
  > | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!['super_admin', 'admin', 'manager'].includes(role)) return null
  async function load() {
    setBusy(true)
    setError('')
    try {
      setData(await getOrderCreatorFinance({ data: { orderId } }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load finance')
    } finally {
      setBusy(false)
    }
  }
  async function run(command: CreatorCommand) {
    setBusy(true)
    setError('')
    try {
      await creatorCommand({ data: command })
      await load()
      await router.invalidate()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save')
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="my-5 rounded-lg border bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Creator commissions & refunds</h2>
        <button disabled={busy} className={secondary} onClick={load}>
          {data ? 'Refresh' : 'Open finance'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {data && (
        <div className="mt-4 space-y-5">
          {data.attribution ? (
            <div className="text-sm">
              <Link
                className="underline"
                to="/admin/creators/$creatorId"
                params={{ creatorId: data.attribution.creator_id }}
              >
                View creator
              </Link>
              <p>
                {data.attribution.code_snapshot} ·{' '}
                {data.attribution.commission_bps / 100}% commission ·{' '}
                {data.attribution.status}
              </p>
              <p>
                Retained products{' '}
                {money(data.attribution.product_revenue_cents)} · Commission{' '}
                {money(data.attribution.earned_cents)} · Settled{' '}
                {money(data.attribution.paid_cents)}
              </p>
              {data.attribution.hold_reasons.map((r) => (
                <p key={r} className="text-amber-700">
                  {r}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              No creator attribution. Historical orders are not assigned
              retroactively.
            </p>
          )}
          {data.canPay && isCod && (
            <form
              className="flex flex-wrap gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void run({
                  action: 'collect_cod',
                  orderId,
                  reference: String(
                    new FormData(e.currentTarget).get('reference'),
                  ),
                })
              }}
            >
              <input
                name="reference"
                required
                aria-label="COD collection reference"
                placeholder="COD collection / remittance reference"
                className={input}
              />
              <button disabled={busy} className={secondary}>
                Confirm COD collected
              </button>
            </form>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Record a return request
            </summary>
            <form
              className="mt-3 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault()
                const form = e.currentTarget
                const f = new FormData(form)
                if (
                  await run({
                    action: 'request_return',
                    orderId,
                    orderItemId: String(f.get('item')),
                    quantity: Number(f.get('quantity')),
                    reason: String(f.get('reason')),
                  })
                )
                  form.reset()
              }}
            >
              <select
                name="item"
                required
                aria-label="Item being returned"
                className={input}
              >
                <option value="">Choose item</option>
                {data.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.product_name_snapshot} · {i.sku_snapshot}
                  </option>
                ))}
              </select>
              <label className="block text-sm">
                Quantity
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  required
                  defaultValue="1"
                  className={input}
                />
              </label>
              <label className="block text-sm">
                Reason
                <input
                  name="reason"
                  required
                  maxLength={1000}
                  className={input}
                />
              </label>
              <button disabled={busy} className={secondary}>
                Record return request
              </button>
            </form>
          </details>
          {data.canPay && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Record a completed refund
              </summary>
              <p className="my-3 text-xs text-neutral-500">
                Record money already refunded through the payment provider. This
                does not send money. Enter PHP accounting amounts and link any
                related return to avoid counting it twice.
              </p>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = e.currentTarget
                  const f = new FormData(form)
                  const items = data.items
                    .map((i) => ({
                      orderItemId: i.id,
                      amountCents: Math.round(Number(f.get(i.id)) * 100),
                      returnId:
                        String(f.get(`return-${i.id}`) ?? '') || undefined,
                    }))
                    .filter((i) => i.amountCents > 0)
                  const shippingCents = Math.round(
                    Number(f.get('shipping')) * 100,
                  )
                  const taxCents = Math.round(Number(f.get('tax')) * 100)
                  if (
                    await run({
                      action: 'record_refund',
                      source:
                        f.get('source') === 'paypal'
                          ? 'paypal'
                          : f.get('source') === 'xendit'
                            ? 'xendit'
                            : 'manual',
                      orderId,
                      reference: String(f.get('reference')),
                      amountCents: items.reduce(
                        (s, i) => s + i.amountCents,
                        shippingCents + taxCents,
                      ),
                      shippingCents,
                      taxCents,
                      occurredAt: new Date(String(f.get('date'))).toISOString(),
                      items,
                    })
                  )
                    form.reset()
                }}
              >
                <label className="block text-sm">
                  Refund provider
                  <select name="source" className={input}>
                    <option value="manual">Manual / COD</option>
                    <option value="paypal">PayPal</option>
                    <option value="xendit">Xendit</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Provider refund reference
                  <input
                    name="reference"
                    required
                    maxLength={200}
                    className={input}
                  />
                </label>
                <label className="block text-sm">
                  Refund completed at
                  <input
                    name="date"
                    type="datetime-local"
                    required
                    className={input}
                  />
                </label>
                {data.items.map((i) => (
                  <div key={i.id} className="grid gap-2 sm:grid-cols-2">
                    <label className="text-sm">
                      {i.product_name_snapshot} ({i.sku_snapshot}) · refund PHP
                      <input
                        name={i.id}
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue="0"
                        className={input}
                      />
                    </label>
                    <label className="text-sm">
                      Related return
                      <select name={`return-${i.id}`} className={input}>
                        <option value="">No physical return</option>
                        {data.returns
                          .filter((r) => r.order_item_id === i.id)
                          .map((r) => (
                            <option value={r.id} key={r.id}>
                              {r.reason} · {r.status}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                ))}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    Shipping refund PHP
                    <input
                      name="shipping"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                      className={input}
                    />
                  </label>
                  <label className="text-sm">
                    Tax refund PHP
                    <input
                      name="tax"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                      className={input}
                    />
                  </label>
                </div>
                <button disabled={busy} className={primary}>
                  Record completed refund
                </button>
              </form>
            </details>
          )}
          {data.refunds.length > 0 && (
            <div className="text-sm">
              <h3 className="font-medium">Recorded refunds</h3>
              {data.refunds.map((r) => (
                <p key={r.id}>
                  {r.source} / {r.external_id} · {money(r.amount_cents)} ·{' '}
                  {r.allocation_complete ? 'Allocated' : 'Needs allocation'}
                </p>
              ))}
            </div>
          )}
          {data.canPay &&
            data.returns
              .filter((r) => r.status !== 'rejected')
              .map((r) => (
                <form
                  key={r.id}
                  className="rounded border p-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const f = new FormData(e.currentTarget)
                    void run({
                      action: 'receive_return',
                      returnId: r.id,
                      orderItemId: String(f.get('item')),
                      restock: f.get('restock') === 'on',
                    })
                  }}
                >
                  <p className="mb-2 text-sm">
                    Return: {r.reason} · {r.quantity} units · {r.status}
                  </p>
                  <select
                    name="item"
                    required
                    defaultValue={r.order_item_id ?? ''}
                    aria-label="Returned order item"
                    className={input}
                  >
                    <option value="">Match returned item</option>
                    {data.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.product_name_snapshot} · {i.sku_snapshot}
                      </option>
                    ))}
                  </select>
                  <label className="my-3 flex gap-2 text-sm">
                    <input name="restock" type="checkbox" />
                    Received and resellable — return to inventory
                  </label>
                  <button disabled={busy} className={secondary}>
                    Confirm goods received
                  </button>
                  {(r.status === 'requested' || r.status === 'approved') && (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${secondary} ml-2`}
                      onClick={() =>
                        run({ action: 'resolve_return', returnId: r.id })
                      }
                    >
                      Reject return
                    </button>
                  )}
                </form>
              ))}
          {data.entries.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">
                Commission adjustment history
              </summary>
              {data.entries.map((entry) => (
                <p key={entry.id} className="mt-2 text-xs">
                  {new Date(entry.created_at).toLocaleString()} · {entry.reason}{' '}
                  · {money(entry.amount_cents)}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  )
}
