import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DATE_RANGE_LABELS,
  DATE_RANGE_PRESETS,
  daysAgo,
  formatDateRangeLabel,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import {
  addMonths,
  monthGrid,
  monthLabel,
  monthOf,
  nextRangeSelection,
} from '#/lib/utils/calendar'
import type { MonthRef, RangeSelection } from '#/lib/utils/calendar'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Custom range as one month calendar: click the first day, then the last
 * day, then Apply — instead of two separate native date inputs that each
 * needed their own calendar popup.
 */
function RangeCalendar({
  selection,
  onSelect,
  initialMonth,
}: {
  selection: RangeSelection
  onSelect: (next: RangeSelection) => void
  initialMonth: MonthRef
}) {
  const [view, setView] = useState<MonthRef>(initialMonth)
  const [hovered, setHovered] = useState<string | null>(null)
  const today = daysAgo(0)

  // While only the start is picked, preview the range up to the hovered day.
  const previewEnd =
    selection.from && !selection.to && hovered && hovered >= selection.from
      ? hovered
      : null
  const rangeEnd = selection.to ?? previewEnd

  return (
    <div onMouseLeave={() => setHovered(null)}>
      <div className="mb-1 flex items-center justify-between px-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setView((v) => addMonths(v, -1))}
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-neutral-900">
          {monthLabel(view)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView((v) => addMonths(v, 1))}
          className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-neutral-400">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {monthGrid(view).map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />
          const isStart = date === selection.from
          const isEnd = date === rangeEnd
          const inRange =
            selection.from !== null &&
            rangeEnd !== null &&
            date > selection.from &&
            date < rangeEnd
          return (
            <button
              key={date}
              type="button"
              aria-label={shortDate(date)}
              aria-pressed={isStart || isEnd}
              onClick={() => onSelect(nextRangeSelection(selection, date))}
              onMouseEnter={() => setHovered(date)}
              className={`h-8 ${
                isStart || isEnd
                  ? 'rounded-md bg-neutral-900 font-semibold text-white'
                  : inRange
                    ? 'bg-neutral-100 text-neutral-900'
                    : 'rounded-md text-neutral-700 hover:bg-neutral-100'
              } ${date === today && !isStart && !isEnd ? 'font-semibold underline' : ''}`}
            >
              {Number(date.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
  const [selection, setSelection] = useState<RangeSelection>({ from, to })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelection({ from, to })
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
    <div ref={containerRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 sm:w-auto sm:justify-start"
      >
        <span className="inline-flex items-center gap-2">
          <Calendar size={15} />
          {formatDateRangeLabel({ from, to })}
        </span>
        <ChevronDown size={15} className="text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 z-10 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-200 bg-white p-2 shadow-lg sm:left-auto sm:right-0">
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
            <div className="px-1">
              <RangeCalendar
                // Reopening the picker starts on the current range's month.
                key={String(open)}
                selection={selection}
                onSelect={setSelection}
                initialMonth={monthOf(selection.from ?? to)}
              />
            </div>
            <p className="mt-2 px-1 text-xs text-neutral-600">
              {selection.from
                ? selection.to
                  ? `${shortDate(selection.from)} – ${shortDate(selection.to)}`
                  : `${shortDate(selection.from)} – pick the last day`
                : 'Pick the first day'}
            </p>
            <button
              type="button"
              disabled={!selection.from}
              onClick={() => {
                if (!selection.from) return
                onChange('custom', {
                  from: selection.from,
                  // Only a start picked → a one-day range.
                  to: selection.to ?? selection.from,
                })
                setOpen(false)
              }}
              className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
