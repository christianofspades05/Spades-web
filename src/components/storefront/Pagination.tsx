import { buttonSecondaryClassName } from './ui'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-3 py-10">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={`${buttonSecondaryClassName} px-4 py-2`}
      >
        Previous
      </button>
      <span className="text-sm text-neutral-600 dark:text-neutral-400">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={`${buttonSecondaryClassName} px-4 py-2`}
      >
        Next
      </button>
    </div>
  )
}
