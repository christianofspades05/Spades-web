declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[] }
  }
}

/** Meta Events Manager > Data Sources > pixel ("Dataset ID"). Undefined in any environment that hasn't set it (e.g. a preview deploy) — every call site treats that as "pixel disabled," never an error. */
export const FB_PIXEL_ID: string | undefined = import.meta.env
  .VITE_FB_PIXEL_ID as string | undefined

/**
 * Self-installs `window.fbq` and loads Meta's tracking script — the
 * standard Meta Pixel base code, verbatim except for the interpolated
 * pixel id. Injected as an inline `<script>` in the document `<head>`
 * (see __root.tsx) so it runs before hydration, matching how Shopify's
 * own Pixel integration loads it.
 */
export const FB_PIXEL_BOOTSTRAP_SCRIPT = FB_PIXEL_ID
  ? `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${FB_PIXEL_ID}');
fbq('track', 'PageView');`
  : null

/** Fires a Meta Pixel standard event. A no-op if the pixel never bootstrapped (id unset, script blocked, ad blocker, etc.) — every call site can call this unconditionally. */
export function trackPixelEvent(
  event: string,
  params?: Record<string, unknown>,
) {
  if (typeof window === 'undefined' || !window.fbq) return
  window.fbq('track', event, params)
}
