/**
 * Pulsing placeholder block for route-transition skeletons (`loading.tsx`).
 *
 * Extracted so each new loading boundary doesn't re-declare its own copy — the
 * Home and Play boundaries predate this and still carry a local `Block`; they can
 * migrate onto this whenever they're next touched.
 */
export function SkeletonBlock({
  h = 16,
  w = "100%",
  r = 12,
}: {
  h?: number;
  w?: number | string;
  r?: number;
}) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, width: w, borderRadius: r, background: "rgba(255,255,255,0.06)" }}
    />
  );
}
