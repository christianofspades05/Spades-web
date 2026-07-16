/** Lucide has no TikTok glyph — this mirrors its icon conventions (24x24, currentColor, size/className passthrough). */
export function TikTokIcon({
  size = 24,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M16.6 5.82c-.9-.98-1.4-2.26-1.4-3.6h-3.13v13.44c0 1.62-1.32 2.94-2.95 2.94a2.95 2.95 0 0 1-2.95-2.94 2.95 2.95 0 0 1 2.95-2.94c.28 0 .55.04.8.11V9.7a6.1 6.1 0 0 0-.8-.05A6.08 6.08 0 0 0 3 15.66a6.08 6.08 0 0 0 6.12 6.02 6.08 6.08 0 0 0 6.12-6.02V9.01a7.53 7.53 0 0 0 4.4 1.41V7.3a4.85 4.85 0 0 1-2.44-1.48h-.6z" />
    </svg>
  )
}
