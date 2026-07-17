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
}: {
  bars: BarChartBar[]
  height?: number
  color?: string
}) {
  const max = Math.max(...bars.map((b) => b.value), 1)

  if (bars.length === 0) {
    return <p className="text-sm text-neutral-400">No data in this range.</p>
  }

  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {bars.map((bar, i) => {
        const barHeight = Math.max((bar.value / max) * (height - 28), 2)
        return (
          <div
            key={i}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            <span className="text-xs font-medium text-neutral-700">
              {bar.value}
            </span>
            <div
              className="w-full max-w-12 rounded-t-sm"
              style={{
                height: barHeight,
                backgroundColor: bar.color ?? color,
              }}
            />
            <span className="w-full truncate text-center text-xs text-neutral-500">
              {bar.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
