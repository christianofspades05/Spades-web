const STORAGE_KEY = 'spades_visitor_id'

/** Random, anonymous per-browser id used only to count unique storefront visitors. */
export function getOrCreateVisitorId(): string {
  const existing = window.localStorage.getItem(STORAGE_KEY)
  if (existing) return existing

  const id = crypto.randomUUID()
  window.localStorage.setItem(STORAGE_KEY, id)
  return id
}
