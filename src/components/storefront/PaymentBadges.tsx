import { Banknote } from 'lucide-react'

const CARD_LOGOS = [
  { src: '/payments/visa.svg', alt: 'Visa' },
  { src: '/payments/mastercard.svg', alt: 'Mastercard' },
  { src: '/payments/amex.svg', alt: 'American Express' },
]

const WALLET_LOGOS = [
  { src: '/payments/gcash.svg', alt: 'GCash' },
  { src: '/payments/maya.svg', alt: 'Maya' },
  { src: '/payments/qrph.svg', alt: 'QR Ph' },
  { src: '/payments/gotyme.svg', alt: 'GoTyme' },
  { src: '/payments/seabank.svg', alt: 'SeaBank' },
]

export function PaymentBadges() {
  return (
    <div className="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Payment methods
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {CARD_LOGOS.map((logo) => (
          <span
            key={logo.alt}
            className="flex h-8 items-center rounded-md border border-neutral-200 bg-white px-2.5"
          >
            <img src={logo.src} alt={logo.alt} className="h-4 w-auto" />
          </span>
        ))}
        {WALLET_LOGOS.map((logo) => (
          <span
            key={logo.alt}
            className="flex h-8 items-center rounded-md border border-neutral-200 bg-white px-2.5"
          >
            <img src={logo.src} alt={logo.alt} className="h-3.5 w-auto" />
          </span>
        ))}
        <span className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-700">
          <Banknote size={14} />
          Cash on Delivery
        </span>
      </div>
    </div>
  )
}
