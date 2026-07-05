"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { smartBackTarget } from "@/lib/nav";

/**
 * Standard top-left "back" control for every screen — a pill, tinted to its area:
 *   neutral (default) · wc (gold) · draft (38-0 lime) · play (teal).
 * Prefer `fallback`: retraces the player's actual steps via the session nav
 * trail (src/lib/nav.ts), landing on `fallback` only when there's no trail
 * (deep link, fresh session). `href` teleports unconditionally — keep it for
 * screens with exactly one sane parent (deep 38-0 hierarchy, legal pages).
 * Omit both to go back in raw history.
 * `sticky` pins it to the top of a scroll (used on long lists like the WC board).
 */
type Tone = "neutral" | "wc" | "draft" | "play";

const TONES: Record<Tone, { bg: string; border: string; color: string }> = {
  neutral: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.16)", color: "#cfcfe6" },
  wc:      { bg: "rgba(255,184,0,0.14)",   border: "rgba(255,184,0,0.45)",   color: "#ffb800" },
  draft:   { bg: "rgba(174,234,0,0.13)",   border: "rgba(174,234,0,0.42)",   color: "#aeea00" },
  play:    { bg: "rgba(0,216,192,0.13)",   border: "rgba(0,216,192,0.42)",   color: "#00d8c0" },
};

export function BackPill({ href, fallback, label = "Back", tone = "neutral", sticky = false, onClick, className = "" }: {
  href?: string; fallback?: string; label?: string; tone?: Tone; sticky?: boolean; onClick?: () => void; className?: string;
}) {
  const router = useRouter();
  const t = TONES[tone];
  const cls = `inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 font-display tracking-wide active:scale-95 transition-transform ${className}`;
  const style: React.CSSProperties = { background: t.bg, border: `1px solid ${t.border}`, color: t.color, fontSize: 13, lineHeight: 1 };
  const inner = (<><span aria-hidden style={{ fontSize: 15 }}>←</span><span>{label}</span></>);

  const handleClick =
    onClick ??
    (fallback !== undefined
      ? () => router.push(smartBackTarget(fallback))
      : () => router.back());

  const pill = href
    ? <Link href={href} className={cls} style={style}>{inner}</Link>
    : <button type="button" onClick={handleClick} className={cls} style={style}>{inner}</button>;

  if (!sticky) return pill;
  return (
    <div className="sticky top-0 z-30" style={{ background: "rgba(10,10,15,0.82)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", paddingTop: "calc(env(safe-area-inset-top,0px) + 10px)", paddingBottom: 10 }}>
      {pill}
    </div>
  );
}
