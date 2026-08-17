import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { percentChange } from '#/lib/utils/date-range'

export interface TrendChartPoint {
  label: string
  current: number
  previous: number
}

function TrendTooltip({
  active,
  payload,
  formatValue,
  color,
}: {
  active?: boolean
  payload?: { payload: TrendChartPoint }[]
  formatValue: (value: number) => string
  color: string
}) {
  if (!active || !payload?.[0]) return null
  const point = payload[0].payload
  const change = percentChange(point.current, point.previous)

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-neutral-900">{point.label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-neutral-700">{formatValue(point.current)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-neutral-300" />
        <span className="text-neutral-500">
          {formatValue(point.previous)} previous period
        </span>
      </div>
      {change !== null && (
        <p
          className={`mt-1 font-medium ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
        >
          {change >= 0 ? '+' : ''}
          {change}%
        </p>
      )}
    </div>
  )
}

/**
 * The big per-metric chart on the Home dashboard — current period (solid)
 * overlaid with the previous period (dashed) at the same bucket index, e.g.
 * "this hour today" against "the same hour yesterday". Give every chart on
 * the same page the same `syncId` to have Recharts sync the hover crosshair/
 * tooltip across all of them (a built-in Recharts feature, no custom code).
 */
export function TrendLineChart({
  data,
  color = '#2c6ecb',
  formatValue = (v) => String(v),
  syncId,
}: {
  data: TrendChartPoint[]
  color?: string
  formatValue?: (value: number) => string
  syncId?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart
        data={data}
        syncId={syncId}
        margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
      >
        <CartesianGrid stroke="#f0f0f0" vertical={false} />
        <Tooltip content={<TrendTooltip formatValue={formatValue} color={color} />} />
        <Line
          type="monotone"
          dataKey="previous"
          stroke="#d1d5db"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="current"
          stroke={color}
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Tiny inline trend indicator next to a KPI number — current period only, no axes/tooltip/grid. */
export function MetricSparkline({
  values,
  color = '#2c6ecb',
}: {
  values: number[]
  color?: string
}) {
  const data = values.map((value) => ({ value }))
  return (
    <ResponsiveContainer width={80} height={32}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
