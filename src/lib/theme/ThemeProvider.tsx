import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'theme'

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * Storefront-only theme toggle. Defaults to 'light' on both server and first
 * client render (so hydration always matches) — the actual dark/light paint
 * is handled by a blocking inline script in __root.tsx that runs before
 * hydration, so there's no flash even though this state starts as 'light'.
 * The effect below syncs this context's state to match what that script
 * already applied: an explicit stored preference if there is one, otherwise
 * `defaultTheme` (the current brand's out-of-the-box theme — see
 * StorefrontScope.defaultTheme in server/storefront/domain.ts).
 */
export function ThemeProvider({
  children,
  defaultTheme,
}: {
  children: React.ReactNode
  defaultTheme: Theme
}) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    setTheme(stored === 'dark' || stored === 'light' ? stored : defaultTheme)
  }, [defaultTheme])

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEY, next)
      applyThemeClass(next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
