import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import {
  DATE_RANGE_LABELS,
  DATE_RANGE_PRESETS,
  formatDateRangeLabel,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { inputClassName } from '#/components/admin/ui'

export function DateRangePicker({
  preset,
  from,
  to,
  onChange,
}: {
  preset: DateRangePreset
  from: string
  to: string
  onChange: (
    preset: DateRangePreset,
    custom?: { from: string; to: string },
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCustomFrom(from)
    setCustomTo(to)
  }, [from, to])

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
      >
        <Calendar size={15} />
        {formatDateRangeLabel({ from, to })}
        <ChevronDown size={15} className="text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-200 bg-white p-2 shadow-lg sm:left-auto sm:right-0">
          <ul className="flex flex-col">
            {DATE_RANGE_PRESETS.filter((p) => p !== 'custom').map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p)
                    setOpen(false)
                  }}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-neutral-50 ${
                    preset === p
                      ? 'bg-neutral-100 font-medium text-neutral-900'
                      : 'text-neutral-700'
                  }`}
                >
                  {DATE_RANGE_LABELS[p]}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-2 border-t border-neutral-200 pt-2">
            <p className="px-1 pb-1.5 text-xs font-medium text-neutral-500">
              Custom range
            </p>
            <div className="flex items-center gap-2 px-1">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={`${inputClassName} w-full px-2 py-1.5 text-xs`}
              />
              <span className="text-neutral-400">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                className={`${inputClassName} w-full px-2 py-1.5 text-xs`}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange('custom', { from: customFrom, to: customTo })
                setOpen(false)
              }}
              className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
