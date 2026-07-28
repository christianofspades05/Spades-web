declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] }
  }
}

/**
 * Self-installs `window.fbq` and loads Meta's tracking script — the
 * standard Meta Pixel base code, verbatim except for the interpolated
 * pixel id. Injected as an inline `<script>` in the document `<head>`
 * (see __root.tsx) so it runs before hydration, matching how Shopify's
 * own Pixel integration loads it.
 *
 * Takes the pixel id as a param (from the current request's
 * StorefrontScope, see server/storefront/domain.ts) rather than reading a
 * single global env var directly — Spades/Ysrael/Aspire 365 now share one
 * deployment but each needs its own pixel. Returns null (renders nothing)
 * when unset — e.g. a preview deploy, or a brand that hasn't had its pixel
 * configured yet — every call site already treats that as "pixel
 * disabled," never an error.
 */
export function buildPixelBootstrapScript(
  pixelId: string | undefined,
): string | null {
  if (!pixelId) return null
  return `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');`
}

/** Fires a Meta Pixel standard event. A no-op if the pixel never bootstrapped (id unset, script blocked, ad blocker, etc.) — every call site can call this unconditionally. */
export function trackPixelEvent(
  event: string,
  params?: Record<string, unknown>,
) {
  if (typeof window === 'undefined' || !window.fbq) return
  window.fbq('track', event, params)
}
