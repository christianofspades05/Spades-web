import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { getCustomerSession } from '#/server/account/auth'
import { getAccountOverview } from '#/server/account/queries'
import { cancelMyOrder } from '#/server/account/orders'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { formatCents } from '#/lib/utils/money'
import { formatRegionLabel } from '#/lib/utils/ph-region'
import { getErrorMessage } from '#/lib/utils/errors'
import { AddAddressForm } from '#/components/storefront/AddAddressForm'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/account/')({
  beforeLoad: async () => {
    // getCustomerSession/getCurrentCustomer already recover from a corrupted
    // session cookie internally (see lib/auth/session.ts), but this catch is
    // a last line of defense — anything unexpected that still slips through
    // sends the user to log in again instead of crashing the page outright.
    let customer
    try {
      customer = await getCustomerSession()
    } catch {
      customer = null
    }
    if (!customer) throw redirect({ to: '/account/login' })
  },
  loader: () => getAccountOverview(),
  component: AccountPage,
})

function AccountPage() {
  const { t } = useLanguage()
  const { customer, orders, addresses } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [showAddressForm, setShowAddressForm] = useState(false)

  async function handleLogout() {
    await getSupabaseBrowserClient().auth.signOut()
    await navigate({ to: '/' })
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {customer.full_name ?? t.account.yourAccount}
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {customer.email}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className={buttonSecondaryClassName}
        >
          {t.account.logOut}
        </button>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t.account.orderHistory}</h2>
        {orders.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            {t.account.noOrdersYet}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
                  <th className="px-4 py-3">{t.account.orderColumn}</th>
                  <th className="px-4 py-3">{t.account.itemsColumn}</th>
                  <th className="px-4 py-3">
                    {t.account.trackingNumberColumn}
                  </th>
                  <th className="px-4 py-3">{t.account.trackingColumn}</th>
                  <th className="px-4 py-3 text-right">
                    {t.account.paymentColumn}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {orders.map((order) => (
                  <tr key={order.id} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-medium text-neutral-900 dark:text-white">
                        {order.order_number}
                      </p>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        {new Date(order.placed_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        {order.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2"
                          >
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt=""
                                className="size-9 shrink-0 rounded object-cover"
                              />
                            ) : (
                              <div className="size-9 shrink-0 rounded bg-neutral-200 dark:bg-neutral-800" />
                            )}
                            <span className="whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                              {item.product_name_snapshot}
                              {item.variant_label_snapshot &&
                                ` — ${item.variant_label_snapshot}`}
                              {item.quantity > 1 && ` ×${item.quantity}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                      {order.isFulfilled
                        ? (order.trackingNumber ?? '—')
                        : t.account.unfulfilled}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {order.isFulfilled && order.trackingUrl ? (
                        <a
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-neutral-900 underline dark:text-white"
                        >
                          {t.account.trackPackage}
                        </a>
                      ) : (
                        <span className="text-neutral-700 dark:text-neutral-300">
                          {order.isFulfilled ? '—' : t.account.noTracking}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <p className="font-medium text-neutral-900 dark:text-white">
                        {formatCents(order.total_cents, order.currency)}
                      </p>
                      <p className="text-neutral-500 capitalize dark:text-neutral-400">
                        {order.status.replace(/_/g, ' ')}
                      </p>
                      {order.canCancel && (
                        <CancelOrderButton
                          orderId={order.id}
                          onCancelled={() => router.invalidate()}
                        />
                      )}
                      {order.canReview && (
                        <Link
                          to="/account/orders/$orderId/review"
                          params={{ orderId: order.id }}
                          className="mt-1 block text-xs font-medium text-neutral-900 underline dark:text-white"
                        >
                          {t.account.writeReview}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t.account.savedAddresses}
          </h2>
          {!showAddressForm && (
            <button
              type="button"
              onClick={() => setShowAddressForm(true)}
              className={buttonSecondaryClassName}
            >
              {t.account.addAddress}
            </button>
          )}
        </div>

        {addresses.length === 0 && !showAddressForm && (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            {t.account.noSavedAddresses}
          </p>
        )}

        {addresses.length > 0 && (
          <ul className="mt-4 flex flex-col gap-3">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800"
              >
                <p className="font-medium text-neutral-900 dark:text-white">
                  {address.recipient_name}
                  {address.label && (
                    <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400">
                      {address.label}
                    </span>
                  )}
                </p>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {address.phone}
                </p>
                <p className="text-neutral-500 dark:text-neutral-400">
                  {[
                    address.address_line1,
                    address.address_line2,
                    address.barangay,
                    address.city,
                    address.province,
                    formatRegionLabel(address.region),
                    address.postal_code,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}

        {showAddressForm && (
          <AddAddressForm
            onAdded={() => {
              setShowAddressForm(false)
              router.invalidate()
            }}
            onCancel={() => setShowAddressForm(false)}
          />
        )}
      </section>
    </div>
  )
}

function CancelOrderButton({
  orderId,
  onCancelled,
}: {
  orderId: string
  onCancelled: () => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setOpen(false)
    setReason('')
    setError(null)
  }

  async function handleConfirm() {
    if (!reason.trim()) {
      setError(t.account.cancelReasonRequired)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await cancelMyOrder({ data: { orderId, reason: reason.trim() } })
      onCancelled()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs text-red-600 underline dark:text-red-400"
      >
        {t.account.cancelOrder}
      </button>

      {open && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 text-left shadow-xl dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
              {t.account.cancelOrderTitle}
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {t.account.cancelOrderBody}
            </p>

            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.account.cancelReasonPlaceholder}
              rows={3}
              autoFocus
              className={`${inputClassName} mt-4 w-full resize-none`}
            />

            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className={buttonSecondaryClassName}
              >
                {t.account.neverMind}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirm}
                className={buttonPrimaryClassName}
              >
                {submitting
                  ? t.account.cancelling
                  : t.account.confirmCancellation}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
