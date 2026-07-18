export function Card({
  children,
  className = '',
  onClick,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>
  onTouchEnd?: React.TouchEventHandler<HTMLDivElement>
  onTouchMove?: React.TouchEventHandler<HTMLDivElement>
}) {
  return (
    <div
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      className={`rounded-xl border border-neutral-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  )
}
