/**
 * Guest cart identity. RLS has no anon read/write policy for `carts`/
 * `cart_items` by design (see 0001_init_schema.sql) — guest carts are meant
 * to be managed entirely by server-only code via a random, unguessable
 * session token stored in an httpOnly cookie, never a customer id.
 */
import { getCookies, setCookie } from '@tanstack/react-start/server'

const CART_COOKIE_NAME = 'spades_cart_token'
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function getCartToken(): string | undefined {
  return getCookies()[CART_COOKIE_NAME]
}

export function setCartToken(token: string) {
  setCookie(CART_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  })
}
