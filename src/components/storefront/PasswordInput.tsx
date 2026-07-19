import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { inputClassName } from '#/components/storefront/ui'

export function PasswordInput({
  value,
  onChange,
  minLength,
  autoComplete,
}: {
  value: string
  onChange: (value: string) => void
  minLength?: number
  autoComplete?: string
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClassName} w-full pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
