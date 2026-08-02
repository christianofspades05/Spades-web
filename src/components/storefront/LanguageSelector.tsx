import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '#/lib/i18n/translations'

/** Lets a visitor change language after the initial popup (or if they're
 *  from a country the popup never targets) — same interaction pattern as
 *  CurrencySelector right next to it. */
export function LanguageSelector() {
  const { language, setLanguage } = useLanguage()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select language"
        aria-expanded={open}
        className="flex items-center gap-0.5 rounded-md p-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {language.toUpperCase()}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-28 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => {
                setLanguage(lang)
                setOpen(false)
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                lang === language
                  ? 'font-semibold text-neutral-950 dark:text-white'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              {LANGUAGE_LABELS[lang]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
