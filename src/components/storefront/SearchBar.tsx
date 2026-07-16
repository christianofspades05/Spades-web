import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useDebouncedValue } from '#/lib/hooks/useDebouncedValue'
import { inputClassName } from './ui'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [text, setText] = useState(value)
  const debounced = useDebouncedValue(text, 300)

  useEffect(() => {
    if (debounced !== value) onChange(debounced)
    // Only fire when the debounced text actually settles on a new value.
  }, [debounced])

  useEffect(() => {
    setText(value)
  }, [value])

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search products..."
        className={`${inputClassName} w-full pl-9`}
      />
    </div>
  )
}
