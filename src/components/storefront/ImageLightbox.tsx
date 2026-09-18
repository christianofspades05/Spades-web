import { useEffect } from 'react'

/**
 * Full-screen photo viewer shared by the storefront product page's review
 * photos and the admin Reviews list's thumbnails — closable via the ×
 * button, clicking the backdrop, or Escape. Renders nothing while `url` is
 * null; the caller owns which url (if any) is open.
 */
export function ImageLightbox({
  url,
  onClose,
  alt = 'Full-size photo',
}: {
  url: string | null
  onClose: () => void
  alt?: string
}) {
  useEffect(() => {
    if (!url) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [url, onClose])

  if (!url) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-xl text-white hover:bg-white/20"
      >
        ×
      </button>
      <img
        src={url}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  )
}
