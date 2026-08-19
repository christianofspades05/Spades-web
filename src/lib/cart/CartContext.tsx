import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getCart } from '#/server/cart/queries'
import {
  addCartItem,
  applyDiscountCode,
  removeCartItem,
  removeDiscountCode,
  updateCartItemQuantity,
} from '#/server/cart/mutations'
import type { CartWithItems } from '#/server/cart/internal'

interface CartContextValue {
  cart: CartWithItems | null
  itemCount: number
  subtotalCents: number
  discountCents: number
  totalCents: number
  codAvailable: boolean
  codUnavailableReason: string | null
  isLoading: boolean
  addItem: (variantId: string, quantity: number) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  removeItem: (cartItemId: string) => Promise<void>
  applyDiscountCode: (code: string) => Promise<void>
  removeDiscountCode: () => Promise<void>
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartWithItems | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    function refetch() {
      getCart()
        .then((result) => {
          if (!cancelled) setCart(result)
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    }
    refetch()

    // Online-payment checkout navigates away with a real page load
    // (window.location.href = invoiceUrl — has to be, Xendit/PayPal are a
    // different origin), converting this cart server-side the moment it
    // succeeds. If the customer then taps the browser Back button instead
    // of finishing payment, the browser can restore this exact page from
    // bfcache rather than reloading it — the mount effect above never
    // reruns, so the stale pre-navigation cart (subtotal, items, an
    // enabled "Continue to pay" button) stays on screen even though the
    // cart behind it is already gone, so submitting it fails with a
    // confusing "Your cart is empty" error next to totals that still show.
    // Refetching on a persisted pageshow catches that restore and gets the
    // real current cart, so a stale page corrects itself instead.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) refetch()
    }
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      cancelled = true
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  const value = useMemo<CartContextValue>(() => {
    const subtotalCents =
      cart?.items.reduce(
        (sum, item) => sum + item.quantity * item.price_cents_snapshot,
        0,
      ) ?? 0
    const discountCents = cart?.discount?.amountCents ?? 0

    return {
      cart,
      itemCount: cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
      subtotalCents,
      discountCents,
      totalCents: Math.max(0, subtotalCents - discountCents),
      codAvailable: cart?.codAvailable ?? true,
      codUnavailableReason: cart?.codUnavailableReason ?? null,
      isLoading,
      addItem: async (variantId, quantity) => {
        const updated = await addCartItem({ data: { variantId, quantity } })
        setCart(updated)
      },
      updateQuantity: async (cartItemId, quantity) => {
        const updated = await updateCartItemQuantity({
          data: { cartItemId, quantity },
        })
        setCart(updated)
      },
      removeItem: async (cartItemId) => {
        const updated = await removeCartItem({ data: { cartItemId } })
        setCart(updated)
      },
      applyDiscountCode: async (code) => {
        const updated = await applyDiscountCode({ data: { code } })
        setCart(updated)
      },
      removeDiscountCode: async () => {
        const updated = await removeDiscountCode()
        setCart(updated)
      },
    }
  }, [cart, isLoading])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within a CartProvider')
  return context
}
