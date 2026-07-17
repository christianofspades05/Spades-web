export function Card({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-neutral-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  )
}
