import { useState } from 'react'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  translations,
} from '#/lib/i18n/translations'
import type { Language } from '#/lib/i18n/translations'

/** Shown once to a first-time visitor whose geo-detected country is one of
 *  the six this targets (Singapore/Hong Kong/Macau/Taiwan/Japan/South
 *  Korea) — see LanguageContext.tsx for exactly when. Pre-selects that
 *  country's default language, but the visitor can pick any supported
 *  language before confirming (e.g. a Japan visitor who'd rather browse in
 *  English). */
export function LanguagePopup() {
  const { showPopup, suggestedLanguage, confirmLanguage } = useLanguage()
  const [selected, setSelected] = useState<Language>(suggestedLanguage)

  if (!showPopup) return null

  const copy = translations[selected].languagePopup

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
          {copy.title}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {copy.body}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setSelected(lang)}
              className={`rounded-md border px-4 py-2.5 text-left text-sm font-medium transition ${
                selected === lang
                  ? 'border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-800'
                  : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300'
              }`}
            >
              {LANGUAGE_LABELS[lang]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => confirmLanguage(selected)}
          className="mt-5 w-full rounded-full bg-neutral-950 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
        >
          {copy.continueButton}
        </button>
      </div>
    </div>
  )
}
