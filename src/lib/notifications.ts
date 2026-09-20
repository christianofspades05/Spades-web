/**
 * Best-effort browser notification — some browsers/contexts (e.g. Chrome on
 * Android) throw "Illegal constructor" from `new Notification(...)` even
 * when permission is granted, since they require the Service Worker
 * notification API instead. Never let that surface as if the actual
 * operation had failed.
 */
export function notifySafely(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    new Notification(title, { body })
  } catch {
    // Ignored — the in-page result panel already shows the outcome.
  }
}

/** Only prompts if the user has never been asked (or explicitly dismissed
 *  without denying) — never re-prompts once they've granted or denied. */
export function requestNotificationPermissionIfNeeded(): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'default') return
  void Notification.requestPermission()
}
