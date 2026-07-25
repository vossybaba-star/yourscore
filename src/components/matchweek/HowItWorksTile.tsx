"use client";

/**
 * A compact "how it works" door — one tile, one tap into the full explainer.
 * Founder (25 Jul): the rules should be a tile at the top of the tab, not a
 * paragraph the eye slides off. Tinted teal to match the Gameday / knowledge
 * surfaces; drops the whole card onto its own line so the tap target is the
 * width of the screen, not a link buried in prose.
 */

import Link from "next/link";

const TEAL = "#00d8c0";

export function HowItWorksTile({
  href,
  title,
  sub,
}: {
  href: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <Link
        href={href}
        className="flex items-center gap-3 rounded-2xl px-4 py-3.5 active:scale-[0.99] transition-transform"
        style={{
          background: "linear-gradient(150deg, rgba(0,216,192,0.10), rgba(0,216,192,0.02))",
          border: "1px solid rgba(0,216,192,0.22)",
        }}
      >
        {/* Question-mark seal — the universal "explain this" glyph. */}
        <div
          className="flex items-center justify-center rounded-full flex-shrink-0 font-display"
          style={{
            width: 34, height: 34, fontSize: 16,
            background: "rgba(0,216,192,0.14)", color: TEAL,
            border: "1px solid rgba(0,216,192,0.32)",
          }}
          aria-hidden="true"
        >
          ?
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-white leading-tight" style={{ fontSize: 15 }}>
            {title}
          </p>
          <p className="font-body mt-0.5 truncate" style={{ fontSize: 12, color: "#8a948f" }}>
            {sub}
          </p>
        </div>
        <span aria-hidden="true" style={{ color: TEAL, fontSize: 18, flexShrink: 0 }}>
          →
        </span>
      </Link>
    </div>
  );
}
