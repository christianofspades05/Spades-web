const TONE_CLASSES = {
  success: 'bg-green-100 text-green-800',
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-yellow-100 text-yellow-800',
  critical: 'bg-red-100 text-red-800',
  neutral: 'bg-neutral-100 text-neutral-700',
} as const

export type BadgeTone = keyof typeof TONE_CLASSES

export function Badge({
  tone,
  children,
}: {
  tone: BadgeTone
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}

const PRODUCT_STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  draft: 'neutral',
  archived: 'critical',
}

const ORDER_STATUS_TONE: Record<string, BadgeTone> = {
  pending_payment: 'warning',
  paid: 'success',
  processing: 'info',
  packed: 'info',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'critical',
  refunded: 'critical',
  failed: 'critical',
}

const SHIPMENT_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'neutral',
  packed: 'info',
  in_transit: 'info',
  out_for_delivery: 'info',
  delivered: 'success',
  failed: 'critical',
  returned_to_sender: 'critical',
  fulfilled: 'success',
  unfulfilled: 'neutral',
}

const PAYMENT_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  authorized: 'info',
  captured: 'success',
  failed: 'critical',
  refunded: 'critical',
  partially_refunded: 'warning',
}

const REVIEW_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'critical',
}

const KIND_TONES: Record<
  'product' | 'order' | 'shipment' | 'payment' | 'review',
  Record<string, BadgeTone>
> = {
  product: PRODUCT_STATUS_TONE,
  order: ORDER_STATUS_TONE,
  shipment: SHIPMENT_STATUS_TONE,
  payment: PAYMENT_STATUS_TONE,
  review: REVIEW_STATUS_TONE,
}

/** "captured" is the accurate payment-provider term, but "Paid" is what staff actually want to see. */
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  captured: 'Paid',
}

export function StatusBadge({
  status,
  kind,
}: {
  status: string
  kind: 'product' | 'order' | 'shipment' | 'payment' | 'review'
}) {
  const tone = KIND_TONES[kind][status] ?? 'neutral'
  const label =
    kind === 'payment'
      ? (PAYMENT_STATUS_LABELS[status] ?? status.replace(/_/g, ' '))
      : status.replace(/_/g, ' ')
  return <Badge tone={tone}>{label}</Badge>
}
