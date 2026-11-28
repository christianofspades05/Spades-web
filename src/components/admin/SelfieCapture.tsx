import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw, X } from 'lucide-react'

/** Longest side of the saved selfie — plenty to recognise a face and the
 *  store behind them, while staying ~50–150 KB as JPEG. */
const MAX_SIDE = 720

/**
 * Full-screen live camera for clock-in verification. Only a photo taken
 * right now with the front camera can be used — there is deliberately no
 * "choose from gallery" option, so an old picture can't be reused.
 */
export function SelfieCapture({
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  /** Called with the JPEG once the person taps "Use photo". */
  onConfirm: (photo: Blob) => void
  onCancel: () => void
  busy: boolean
  error: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      if (!('mediaDevices' in navigator)) {
        setCameraError(
          'This browser can’t open the camera. Try Chrome or Safari.',
        )
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        setCameraError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
            : 'Couldn’t open the camera. Close other apps using it and try again.',
        )
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.url)
    }
  }, [photo])

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const scale = Math.min(
      1,
      MAX_SIDE / Math.max(video.videoWidth, video.videoHeight),
    )
    const w = Math.round(video.videoWidth * scale)
    const h = Math.round(video.videoHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Save it the way the person saw it in the (mirrored) preview.
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, w, h)
    canvas.toBlob(
      (blob) => {
        if (blob) setPhoto({ blob, url: URL.createObjectURL(blob) })
      },
      'image/jpeg',
      0.8,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <p className="text-sm font-medium">Take a selfie to clock in</p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="flex size-9 items-center justify-center rounded-full bg-white/10"
        >
          <X size={20} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* Kept mounted so "Retake" goes straight back to the live feed. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full -scale-x-100 object-cover ${
            photo || cameraError ? 'hidden' : ''
          }`}
        />
        {cameraError && (
          <p className="max-w-xs px-6 text-center text-sm text-neutral-300">
            {cameraError}
          </p>
        )}
        {photo && !cameraError && (
          <img
            src={photo.url}
            alt="Your selfie"
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      <div className="px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <p className="mb-3 text-center text-xs text-neutral-400">
          Make sure your face and the store are in the photo.
        </p>
        {error && (
          <p className="mb-3 rounded-lg bg-red-500/20 px-3 py-2 text-center text-sm text-red-200">
            {error}
          </p>
        )}
        {photo ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhoto(null)}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/10 font-medium disabled:opacity-50"
            >
              <RotateCcw size={18} /> Retake
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(photo.blob)}
              className="h-14 rounded-2xl bg-green-600 font-semibold disabled:opacity-50"
            >
              {busy ? 'Clocking in…' : 'Use photo & Clock In'}
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={!!cameraError}
              onClick={capture}
              aria-label="Take photo"
              className="flex size-20 items-center justify-center rounded-full border-4 border-white bg-white/20 active:scale-95 disabled:opacity-30"
            >
              <Camera size={30} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
