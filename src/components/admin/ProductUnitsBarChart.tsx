import {
  Bar,
  BarChart as RechartsBarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface ProductUnitsBar {
  label: string
  unitsSold: number
}

const MAX_LABEL_CHARS = 24

/** Long product names wrap onto multiple lines on a category axis and
 *  overflow into neighboring bars — truncating keeps each row single-line.
 *  The full name still shows on hover via the tooltip. */
function truncateLabel(value: string): string {
  return value.length > MAX_LABEL_CHARS
    ? `${value.slice(0, MAX_LABEL_CHARS - 1)}…`
    : value
}

function UnitsBarTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: ProductUnitsBar }[]
}) {
  if (!active || !payload?.[0]) return null
  const bar = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-neutral-900">{bar.label}</p>
      <p className="mt-0.5 text-blue-600">
        Units sold: {bar.unitsSold.toLocaleString()}
      </p>
    </div>
  )
}

/** Horizontal ranked bar chart — top products by units sold. */
export function ProductUnitsBarChart({
  bars,
  color = '#2c6ecb',
}: {
  bars: ProductUnitsBar[]
  color?: string
}) {
  if (bars.length === 0) {
    return <p className="text-sm text-neutral-400">No sales in this range.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(bars.length * 44, 120)}>
      <RechartsBarChart
        data={bars}
        layout="vertical"
        margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={160}
          tickFormatter={truncateLabel}
          tick={{ fontSize: 12, fill: '#525252' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<UnitsBarTooltip />} />
        <Bar dataKey="unitsSold" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {bars.map((bar) => (
            <Cell key={bar.label} fill={color} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
