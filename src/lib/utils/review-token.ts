import { randomBytes } from 'node:crypto'

/**
 * A single-use, unguessable review-request link identifier. This is an
 * opaque random string looked up directly in `orders.review_token` — not a
 * signed JWT — specifically so it can be invalidated instantly by setting
 * `review_token_used_at`, rather than needing a signature blocklist to
 * revoke it after use.
 */
export function generateReviewToken(): string {
  return randomBytes(32).toString('base64url')
}
