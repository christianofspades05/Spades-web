/** Minimal dependency-free SVG line chart — no charting library is installed in this project. */
export function LineChart({
  values,
  width = 640,
  height = 160,
  color = '#171717',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
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

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill={color} fillOpacity={0.06} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
    </svg>
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
