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
    getCart()
      .then((result) => {
        if (!cancelled) setCart(result)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
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
