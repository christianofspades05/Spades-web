import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'

import { Header } from '#/components/storefront/Header'
import { Footer } from '#/components/storefront/Footer'
import { VisitTracker } from '#/components/storefront/VisitTracker'
import { CartProvider } from '#/lib/cart/CartContext'
import { ThemeProvider } from '#/lib/theme/ThemeProvider'
import appCss from '../styles.css?url'

/**
 * Runs before hydration so a returning dark-mode visitor never sees a flash
 * of the light theme. Sets the class directly via the DOM (not React state)
 * — ThemeProvider's own state starts at 'light' on both server and client to
 * keep hydration consistent, then syncs to match whatever this already set.
 */
const NO_FLASH_THEME_SCRIPT = `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Spades — Philippine Streetwear',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32.png',
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isAdminRoute = pathname.startsWith('/admin')

  return (
    <html lang="en">
      <head>
        {!isAdminRoute && (
          <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        )}
        <HeadContent />
      </head>
      <body>
        <VisitTracker />
        <ThemeProvider>
          <CartProvider>
            {!isAdminRoute && <Header />}
            {children}
            {!isAdminRoute && <Footer />}
          </CartProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
