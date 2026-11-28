/** CSV export and printable payslip for a payroll period (client-side). */
import { formatCentsAsPHP } from '#/lib/utils/money'
import { formatPeriod } from './format'

export interface ExportItem {
  employeeName: string
  pay_type: string
  rate_snapshot_cents: number
  days_worked: number
  regular_hours: number
  overtime_hours: number
  late_minutes: number
  undertime_minutes: number
  absent_days: number
  base_pay_cents: number
  overtime_pay_cents: number
  late_deduction_cents: number
  undertime_deduction_cents: number
  absence_deduction_cents: number
  adjustments: Array<{ label: string; amount_cents: number }>
  gross_pay_cents: number
  net_pay_cents: number
  notes: string | null
}

const peso = (cents: number) => (cents / 100).toFixed(2)

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function payrollCsv(items: ExportItem[]): string {
  const header = [
    'Staff',
    'Pay type',
    'Rate',
    'Days worked',
    'Regular hrs',
    'OT hrs',
    'Late min',
    'Undertime min',
    'Absences',
    'Base',
    'OT pay',
    'Late deduction',
    'Undertime deduction',
    'Absence deduction',
    'Adjustments',
    'Gross',
    'Net',
    'Notes',
  ]
  const rows = items.map((i) => [
    i.employeeName,
    i.pay_type,
    peso(i.rate_snapshot_cents),
    i.days_worked,
    i.regular_hours,
    i.overtime_hours,
    i.late_minutes,
    i.undertime_minutes,
    i.absent_days,
    peso(i.base_pay_cents),
    peso(i.overtime_pay_cents),
    peso(i.late_deduction_cents),
    peso(i.undertime_deduction_cents),
    peso(i.absence_deduction_cents),
    i.adjustments.map((a) => `${a.label}: ${peso(a.amount_cents)}`).join('; '),
    peso(i.gross_pay_cents),
    peso(i.net_pay_cents),
    i.notes ?? '',
  ])
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function payslipHtml(
  item: ExportItem,
  period: { start_date: string; end_date: string; status: string },
): string {
  const line = (label: string, cents: number, negative = false) =>
    cents === 0
      ? ''
      : `<tr><td>${esc(label)}</td><td class="r">${negative ? '−' : ''}${esc(formatCentsAsPHP(Math.abs(cents)))}</td></tr>`
  const rate =
    item.pay_type === 'hourly'
      ? `${formatCentsAsPHP(item.rate_snapshot_cents)} / hour`
      : `${formatCentsAsPHP(item.rate_snapshot_cents)} / month`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip — ${esc(item.employeeName)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:560px;margin:32px auto;padding:0 16px}
h1{font-size:22px;letter-spacing:.2em;margin:0}
.muted{color:#666;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
td{padding:6px 0;border-bottom:1px solid #eee}
.r{text-align:right}
.total td{font-weight:700;border-top:2px solid #111;border-bottom:none;font-size:16px}
@media print{button{display:none}}
</style></head><body>
<h1>SPADES</h1>
<p class="muted">Payslip · ${esc(formatPeriod(period.start_date, period.end_date))}${period.status === 'draft' ? ' · DRAFT' : ''}</p>
<p><strong>${esc(item.employeeName)}</strong><br><span class="muted">${esc(rate)}</span></p>
<table>
<tr><td>Days worked</td><td class="r">${item.days_worked}</td></tr>
<tr><td>Regular hours</td><td class="r">${item.regular_hours}</td></tr>
${item.overtime_hours ? `<tr><td>Overtime hours</td><td class="r">${item.overtime_hours}</td></tr>` : ''}
${item.late_minutes ? `<tr><td>Late (minutes)</td><td class="r">${item.late_minutes}</td></tr>` : ''}
${item.undertime_minutes ? `<tr><td>Undertime (minutes)</td><td class="r">${item.undertime_minutes}</td></tr>` : ''}
${item.absent_days ? `<tr><td>Absences (days)</td><td class="r">${item.absent_days}</td></tr>` : ''}
</table>
<table>
${line('Base pay', item.base_pay_cents)}
${line('Overtime pay', item.overtime_pay_cents)}
${line('Late deduction', item.late_deduction_cents, true)}
${line('Undertime deduction', item.undertime_deduction_cents, true)}
${line('Absence deduction', item.absence_deduction_cents, true)}
${item.adjustments.map((a) => line(a.label, a.amount_cents, a.amount_cents < 0)).join('')}
<tr class="total"><td>Net pay</td><td class="r">${esc(formatCentsAsPHP(item.net_pay_cents))}</td></tr>
</table>
<p style="margin-top:24px"><button onclick="window.print()">Print</button></p>
</body></html>`
}
