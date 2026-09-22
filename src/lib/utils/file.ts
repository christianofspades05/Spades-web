/** Reads a File as a base64 string (no `data:...;base64,` prefix) for JSON-based upload server fns. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Downscales an image File to at most `maxDimension` on its longest edge
 * before it ever reaches Supabase Storage — the storage/egress cost of an
 * oversized original can't be undone later by Vercel's own image optimizer,
 * which only ever shrinks what's already stored, never the stored file
 * itself. Non-image files (video, PDF, etc.) and already-small images pass
 * through untouched. PNGs stay PNGs (to keep transparency); everything else
 * re-encodes as JPEG at `quality`. Falls back to the original file on any
 * failure (unsupported format, canvas unavailable) rather than blocking the
 * upload — this is a size optimization, not a correctness requirement.
 */
export async function resizeImageFile(
  file: File,
  maxDimension: number,
  quality = 0.85,
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    )
    if (scale === 1) {
      bitmap.close()
      return file
    }

    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, quality),
    )
    if (!blob) return file

    const extension = outputType === 'image/png' ? 'png' : 'jpg'
    const baseName = file.name.replace(/\.\w+$/, '')
    return new File([blob], `${baseName}.${extension}`, { type: outputType })
  } catch {
    return file
  }
}
