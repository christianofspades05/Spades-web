import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyButton({
  value,
  label,
  iconOnly = false,
}: {
  value: string
  label: string
  iconOnly?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={label}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}
