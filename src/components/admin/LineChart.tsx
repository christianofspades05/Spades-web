import { useRef, useState } from 'react'

/** Minimal dependency-free SVG line chart — no charting library is installed in this project. */
export function LineChart({
  values,
  labels,
  width = 640,
  height = 160,
  color = '#171717',
  formatValue,
}: {
  values: number[]
  /** One label per value (e.g. "9 AM" or "Jul 17") — shown in the hover tooltip. Omit to keep the chart non-interactive (used for small sparklines). */
  labels?: string[]
  width?: number
  height?: number
  color?: string
  formatValue?: (value: number) => string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const interactive = Boolean(labels)

  if (values.length === 0) return null

  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const padding = 4
  const step =
    values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0

  const points = values.map((v, i) => {
    const x = padding + i * step
    const y = padding + (1 - (v - min) / range) * (height - padding * 2)
    return [x, y] as const
  })

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${(height - padding).toFixed(1)} L${points[0][0].toFixed(1)},${(height - padding).toFixed(1)} Z`

  function handleMouseMove(event: React.MouseEvent<SVGSVGElement>) {
    if (!interactive) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relativeX = ((event.clientX - rect.left) / rect.width) * width

    let nearest = 0
    let nearestDist = Infinity
    points.forEach(([x], i) => {
      const dist = Math.abs(x - relativeX)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    })
    setHoverIndex(nearest)
  }

  const hovered = interactive && hoverIndex !== null ? points[hoverIndex] : null

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={`w-full ${interactive ? 'cursor-crosshair' : ''}`}
        style={{ height }}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <path d={areaPath} fill={color} fillOpacity={0.06} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
        {hovered && (
          <>
            <line
              x1={hovered[0]}
              y1={0}
              x2={hovered[0]}
              y2={height}
              stroke="#e5e5e5"
              strokeWidth={1}
            />
            <circle
              cx={hovered[0]}
              cy={hovered[1]}
              r={3.5}
              fill={color}
              stroke="white"
              strokeWidth={1.5}
            />
          </>
        )}
      </svg>

      {hovered && hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-y-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
          style={{
            left: `${(hovered[0] / width) * 100}%`,
            transform:
              hovered[0] > width / 2
                ? 'translate(-100%, -100%)'
                : 'translate(0, -100%)',
          }}
        >
          {labels?.[hoverIndex] && (
            <p className="font-medium text-neutral-900">{labels[hoverIndex]}</p>
          )}
          <p className="text-neutral-600">
            {formatValue ? formatValue(values[hoverIndex]) : values[hoverIndex]}
          </p>
        </div>
      )}
    </div>
  )
}

export function SparkLine({
  values,
  tone = 'neutral',
}: {
  values: number[]
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  const color =
    tone === 'positive'
      ? '#16a34a'
      : tone === 'negative'
        ? '#dc2626'
        : '#a3a3a3'
  return <LineChart values={values} width={120} height={32} color={color} />
}
