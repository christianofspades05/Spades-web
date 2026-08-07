/**
 * Races a promise against a timeout, rejecting if it doesn't settle in time.
 * For best-effort I/O that already has a safe fallback on rejection (e.g.
 * root beforeLoad's Promise.all, where every call is `.catch()`-guarded) —
 * without this, a hung upstream (a Supabase/Cloudflare edge blip) blocks for
 * however long that upstream takes to give up rather than however long
 * we're willing to wait, which is what turned a handful of Supabase 522s
 * into multi-second-to-a-minute page loads on 2026-08-07.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
