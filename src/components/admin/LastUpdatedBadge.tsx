import { useState } from 'react'
import { History } from 'lucide-react'
import type { LastActivityInfo } from '#/server/admin/last-activity'

/**
 * Small clock-icon button that reveals a one-line "last updated" popover on
 * click — same click-to-open/backdrop-dismiss pattern as ItemsCell in
 * admin/orders/lalamove.tsx. Renders nothing when there's no activity_logs
 * history for the record yet (rare — product/variant creation itself logs
 * an entry, see product.create in server/admin/products.ts).
 */
export function LastUpdatedBadge({ info }: { info: LastActivityInfo | undefined }) {
  const [open, setOpen] = useState(false)
  if (!info) return null

  const label = new Date(info.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const time = new Date(info.updatedAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Last updated"
        className="inline-flex items-center justify-center rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
      >
        <History className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute top-full left-1/2 z-20 mt-1 w-max -translate-x-1/2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs whitespace-nowrap text-neutral-600 shadow-lg">
            Last updated {label}, {time}
            {info.staffName ? ` · ${info.staffName}` : ''}
          </div>
        </>
      )}
    </div>
  )
}
