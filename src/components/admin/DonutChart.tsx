/** Minimal dependency-free SVG donut chart — matches LineChart.tsx's no-library convention. */
export interface DonutChartSlice {
  label: string
  value: number
  color: string
}

export function DonutChart({
  slices,
  size = 200,
  strokeWidth = 32,
}: {
  slices: DonutChartSlice[]
  size?: number
  strokeWidth?: number
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  if (total <= 0) {
    return (
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ width: size, height: size }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={strokeWidth}
        />
      </svg>
    )
  }

  let offset = 0
  const gapDegrees = slices.length > 1 ? 2 : 0

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: size, height: size }}
      className="-rotate-90"
    >
      {slices.map((slice, i) => {
        const fraction = slice.value / total
        const gapFraction = gapDegrees / 360
        const dash = Math.max(
          0,
          fraction * circumference - gapFraction * circumference,
        )
        const dashArray = `${dash} ${circumference - dash}`
        const dashOffset = -offset * circumference
        offset += fraction
        return (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            strokeLinecap={gapDegrees > 0 ? 'round' : 'butt'}
          />
        )
      })}
    </svg>
  )
}
