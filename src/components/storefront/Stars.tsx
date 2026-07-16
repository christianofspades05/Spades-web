import { Star } from 'lucide-react'
import { cn } from '#/lib/utils/cn'

/** Read-only star display for an existing rating (product summary, review cards). */
export function Stars({
  rating,
  size = 16,
}: {
  rating: number
  size?: number
}) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={size}
          className={
            i < Math.round(rating)
              ? 'fill-yellow-400 text-yellow-400'
              : 'fill-neutral-200 text-neutral-200 dark:fill-neutral-700 dark:text-neutral-700'
          }
        />
      ))}
    </div>
  )
}

/** Interactive star picker for the review submission form. */
export function StarRatingInput({
  value,
  onChange,
}: {
  value: number
  onChange: (rating: number) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        const n = i + 1
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className="p-0.5"
          >
            <Star
              size={26}
              className={cn(
                n <= value
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'fill-neutral-200 text-neutral-200 dark:fill-neutral-700 dark:text-neutral-700',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
