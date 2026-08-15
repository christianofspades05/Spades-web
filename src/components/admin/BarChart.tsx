/** Minimal dependency-free SVG bar chart — matches LineChart.tsx/DonutChart.tsx's no-library convention. */
export interface BarChartBar {
  label: string
  value: number
  color?: string
}

export function BarChart({
  bars,
  height = 180,
  color = '#171717',
  onBarClick,
  selectedIndex,
}: {
  bars: BarChartBar[]
  height?: number
  color?: string
  /** When provided, bars become clickable (e.g. to drill into the orders
   *  behind that bar) — passed the clicked bar's index into `bars`. */
  onBarClick?: (index: number) => void
  /** Index of the currently-selected bar, if any — dimmed the rest so the
   *  active one stands out. */
  selectedIndex?: number
}) {
  const max = Math.max(...bars.map((b) => b.value), 1)

  if (bars.length === 0) {
    return <p className="text-sm text-neutral-400">No data in this range.</p>
  }

  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {bars.map((bar, i) => {
        const barHeight = Math.max((bar.value / max) * (height - 28), 2)
        const isDimmed = selectedIndex !== undefined && selectedIndex !== i
        return (
          <button
            key={i}
            type="button"
            disabled={!onBarClick}
            onClick={() => onBarClick?.(i)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded border-0 bg-transparent p-0 ${
              onBarClick ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <span className="text-xs font-medium text-neutral-700">
              {bar.value}
            </span>
            <div
              className="w-full max-w-12 rounded-t-sm transition-opacity"
              style={{
                height: barHeight,
                backgroundColor: bar.color ?? color,
                opacity: isDimmed ? 0.35 : 1,
              }}
            />
            <span
              className={`w-full truncate text-center text-xs ${
                selectedIndex === i
                  ? 'font-semibold text-neutral-900'
                  : 'text-neutral-500'
              }`}
            >
              {bar.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
