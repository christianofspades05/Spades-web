// Routes a product image through Vercel's built-in image optimization
// endpoint — resizes and re-encodes (to WebP where supported) on the fly, so
// a phone downloads a small compressed copy instead of the same full-size
// original JPEG a desktop gets. Works for any framework on Vercel, not just
// Next.js; the allowed source domain is declared in vercel.json's `images`
// config. Only available on an actual Vercel deployment — `vite dev` has no
// such endpoint, so local development just serves the original file.
//
// `width` must exactly match one of the values in vercel.json's
// `images.sizes` — Vercel rejects the request with a 400 otherwise (found
// the hard way: a 500 here silently 400'd every product grid image in
// production since only the vercel.json list, not arbitrary widths, is
// accepted).
export function optimizedImageUrl(
  src: string,
  width: number,
  quality = 75,
): string {
  if (import.meta.env.DEV) return src
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality),
  })
  return `/_vercel/image?${params.toString()}`
}
