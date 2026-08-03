/**
 * Scalloped "seal" badges — the certified/verified look (founder, 3 Aug):
 *   - VerifiedTick: a blue scalloped badge with a white check. Sits next to any
 *     league YourScore itself runs (club, Founder, mixed), so a manager knows the
 *     league is official and not someone's private group.
 *   - LegendSeal: the same seal shape in gold, worn by the first 1,000 managers
 *     to build a squad. Replaces the old flat ⭐ — a proper certified badge, not
 *     a star.
 *
 * Both draw from one scalloped-disc path so the family reads as one system. Pure
 * SVG, no hooks, safe in server and client components alike.
 */

/** A cloud/scalloped disc — N outward bumps around a circle, the shape every
 *  "verified" badge wears. Computed once per (R, bumps); cheap enough inline. */
function scallopPath(cx: number, cy: number, R: number, bumps: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  const ar = (2 * R * Math.sin(Math.PI / bumps)) / 2; // arc radius = half the chord
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i <= bumps; i++) {
    const p = pts[i % bumps];
    d += ` A ${ar.toFixed(2)} ${ar.toFixed(2)} 0 0 1 ${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  }
  return d + " Z";
}

const SCALLOP = scallopPath(12, 12, 9.4, 11);
const CHECK = "M7.6 12.2 l2.9 2.9 l5.9 -6.4"; // a bold tick, centred in the disc

/** Blue verified badge — put beside an official YourScore league's name. */
export function VerifiedTick({ size = 15, title = "Official YourScore league" }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-0.15em" }}>
      <title>{title}</title>
      <path d={SCALLOP} fill="#1d9bf0" />
      <path d={CHECK} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Gold certified seal + the "Legend" wordmark — the first-1,000 badge. */
export function LegendSeal({ size = 15 }: { size?: number }) {
  return (
    <span title="One of the first 1,000 managers to build a squad"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px 2px 6px", borderRadius: 999, background: "rgba(255,194,51,0.16)", border: "1px solid rgba(255,194,51,0.42)" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Legend" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id="legendSeal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd77a" />
            <stop offset="1" stopColor="#f5a623" />
          </linearGradient>
        </defs>
        <path d={SCALLOP} fill="url(#legendSeal)" />
        <path d={CHECK} fill="none" stroke="#3d2600" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#ffc233", letterSpacing: "0.01em" }}>Legend</span>
    </span>
  );
}
