import {
  Bar,
  BarChart as RechartsBarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface ProductProfitBar {
  label: string
  netProfitCents: number
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

function ProfitBarTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean
  payload?: { payload: ProductProfitBar }[]
  formatValue: (value: number) => string
}) {
  if (!active || !payload?.[0]) return null
  const bar = payload[0].payload
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-neutral-900">{bar.label}</p>
      <p className="mt-0.5 text-emerald-600">
        Net profit: {formatValue(bar.netProfitCents)}
      </p>
    </div>
  )
}

/** Horizontal ranked bar chart — top products by net profit. */
export function ProductProfitBarChart({
  bars,
  formatValue,
  color = '#34d399',
}: {
  bars: ProductProfitBar[]
  formatValue: (value: number) => string
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
        <Tooltip content={<ProfitBarTooltip formatValue={formatValue} />} />
        <Bar dataKey="netProfitCents" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {bars.map((bar) => (
            <Cell key={bar.label} fill={color} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
