import { createContext, useContext, useEffect, useState } from 'react'
import {
  COUNTRY_DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  translations,
} from './translations'
import type { Language, Translations } from './translations'

interface LanguageContextValue {
  language: Language
  /** Explicit language switch (e.g. a header language menu) — persists to
   *  localStorage and closes the popup if it's still open. */
  setLanguage: (next: Language) => void
  t: Translations
  showPopup: boolean
  /** Pre-selected choice in the popup — the geo-detected country's default
   *  language, or 'en' if the visitor's country isn't one of the five this
   *  feature targets (see COUNTRY_DEFAULT_LANGUAGE). */
  suggestedLanguage: Language
  /** Confirms whichever language the popup ends up on (either the
   *  suggested one via "Continue", or one the visitor picked instead) and
   *  dismisses the popup. */
  confirmLanguage: (chosen: Language) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

const STORAGE_KEY = 'language'

function isSupportedLanguage(value: string | null): value is Language {
  return (
    value !== null &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

/**
 * Storefront-only. Defaults to 'en' on both server and first client render
 * (avoids a hydration mismatch, same reasoning as ThemeProvider/
 * CurrencyProvider) — the effect below then checks localStorage first, and
 * only shows the popup (for a first-time visitor with no stored
 * preference) when the geo-detected country is one of the five this
 * targets. Every other country's visitor is left on English with no
 * interruption at all.
 */
export function LanguageProvider({
  children,
  geoCountry,
}: {
  children: React.ReactNode
  geoCountry: string | null
}) {
  const [language, setLanguageState] = useState<Language>('en')
  const [showPopup, setShowPopup] = useState(false)

  const suggestedLanguage: Language =
    (geoCountry && COUNTRY_DEFAULT_LANGUAGE[geoCountry]) || 'en'

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isSupportedLanguage(stored)) {
      setLanguageState(stored)
      return
    }
    if (geoCountry && COUNTRY_DEFAULT_LANGUAGE[geoCountry]) {
      setShowPopup(true)
    }
  }, [geoCountry])

  function setLanguage(next: Language) {
    localStorage.setItem(STORAGE_KEY, next)
    setLanguageState(next)
  }

  function confirmLanguage(chosen: Language) {
    setLanguage(chosen)
    setShowPopup(false)
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: translations[language],
        showPopup,
        suggestedLanguage,
        confirmLanguage,
      }}
    >
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return ctx
}
