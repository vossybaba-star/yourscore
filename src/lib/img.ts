// Cover-art URLs point at ORIGINAL Supabase Storage objects — hand-made quiz
// covers are 2-3MB PNGs, and the quiz grids were shipping dozens of them to
// phones at 100-600px render sizes (the single biggest source of "the app is
// slow"). Supabase's render endpoint resizes + re-encodes on the fly (webp via
// Accept negotiation, ~20-70KB at grid sizes) and caches the result on the CDN.
//
// Use this at EVERY cover <img> site; pass the rendered width in CSS px
// (the 2x multiplier below covers retina). Non-storage URLs pass through
// untouched, so badge/logo/external art keeps working.

const OBJECT_MARKER = "/storage/v1/object/public/";
const RENDER_MARKER = "/storage/v1/render/image/public/";

export function coverUrl(url: string | null | undefined, cssWidth: number): string | null {
  if (!url) return null;
  if (!url.includes(OBJECT_MARKER)) return url;
  const width = Math.min(1280, Math.round(cssWidth * 2)); // retina, capped
  return url.replace(OBJECT_MARKER, RENDER_MARKER) + (url.includes("?") ? "&" : "?") + `width=${width}&quality=70`;
}
