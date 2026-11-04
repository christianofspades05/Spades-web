import { useCurrency } from '#/lib/currency/CurrencyContext'

/** Currency's full display name (e.g. "Singapore Dollar") via the
 *  browser's own locale data — avoids hand-maintaining a second name map
 *  alongside CURRENCY_LOCALE in money.ts. */
function currencyDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

/** A dismissible bar offering to switch to the visitor's geo-detected
 *  currency — never an automatic switch (see CurrencyContext.tsx's
 *  showCurrencySuggestion doc comment for why). Shown at most once per
 *  session; dismissing or accepting both hide it for the rest of the
 *  visit. */
export function CurrencySuggestionBanner() {
  const {
    showCurrencySuggestion,
    suggestedCurrency,
    acceptCurrencySuggestion,
    dismissCurrencySuggestion,
  } = useCurrency()

  if (!showCurrencySuggestion || !suggestedCurrency) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-100 flex justify-center px-4 pb-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">
          Shop in{' '}
          <span className="font-semibold text-neutral-950 dark:text-white">
            {currencyDisplayName(suggestedCurrency)} ({suggestedCurrency})
          </span>{' '}
          instead of PHP?
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={dismissCurrencySuggestion}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={acceptCurrencySuggestion}
            className="rounded-full bg-neutral-950 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
          >
            Switch to {suggestedCurrency}
          </button>
        </div>
      </div>
    </div>
  )
}
