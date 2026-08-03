import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { submitEmailCapture } from '#/server/storefront/email-capture'
import { getErrorMessage } from '#/lib/utils/errors'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
} from '#/components/storefront/ui'

const STORAGE_KEY = 'email_capture_dismissed'
const SHOW_DELAY_MS = 1500

/** Marketing email-capture popup — "give us your email, get a one-time
 *  discount code" (see server/storefront/email-capture.ts, which reuses
 *  the admin-configured 'welcome' automation). Shown once per browser
 *  (localStorage-gated, same pattern as LanguagePopup) after a short delay,
 *  and only once the language popup (if any) is out of the way — showing
 *  both at once would stack two modals on a first-time JP/SG/HK/MO/KR
 *  visitor. */
export function EmailCapturePopup({ enabled }: { enabled: boolean }) {
  const { t, showPopup: languagePopupShowing } = useLanguage()
  const [dismissed, setDismissed] = useState(true)
  const [visible, setVisible] = useState(false)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<'sent' | 'already_customer' | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    setDismissed(Boolean(localStorage.getItem(STORAGE_KEY)))
  }, [enabled])

  useEffect(() => {
    if (!enabled || dismissed || languagePopupShowing) return
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, dismissed, languagePopupShowing])

  function close() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { status } = await submitEmailCapture({ data: { email } })
      if (status === 'unavailable') {
        close()
        return
      }
      localStorage.setItem(STORAGE_KEY, '1')
      setResult(status)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 px-4">
      <div className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
        <button
          type="button"
          onClick={close}
          aria-label={t.emailCapture.closeAriaLabel}
          className="absolute top-3 right-3 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <X size={18} />
        </button>

        {result ? (
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            {result === 'sent'
              ? t.emailCapture.successMessage
              : t.emailCapture.alreadyCustomerMessage}
          </p>
        ) : (
          <>
            <h2 className="pr-6 text-lg font-semibold text-neutral-900 dark:text-white">
              {t.emailCapture.title}
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {t.emailCapture.body}
            </p>

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.emailCapture.emailPlaceholder}
                className={inputClassName}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className={`${buttonPrimaryClassName} w-full justify-center`}
              >
                {submitting ? t.emailCapture.sending : t.emailCapture.getCode}
              </button>
              <button
                type="button"
                onClick={close}
                className={`${buttonSecondaryClassName} w-full justify-center`}
              >
                {t.emailCapture.alreadyCustomer}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
