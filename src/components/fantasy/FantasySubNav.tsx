"use client";
/**
 * Fantasy sub-nav — the persistent [ Squad | Scout ] tab strip at the top of the
 * Fantasy tab. Unlike the old buried "Scout" card, this is a real sub-tab: it's
 * always there, in every state (squad, no squad, pre-season), so a player with no
 * team yet can still open the Scout to research before they build.
 *
 * Two tabs only. "Squad" is the fantasy home (/fantasy); "Scout" is the research
 * area (/fantasy/news), which carries its own second-level tabs (Briefing /
 * Players / Shortlist). Active by pathname, so the same strip can sit on both
 * sides if we want it to.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

// Mirrored tokens (shared.tsx colour consts are fine to import, but keeping this
// self-contained avoids pulling the whole "use client" surface for one strip).
const TEAL = "#00d8c0";
const INK = "#eef2f0";
const MUTED = "#8a948f";
const LINE = "rgba(255,255,255,0.07)";

const TABS = [
  { href: "/fantasy", label: "Squad", match: (p: string) => p === "/fantasy" },
  {
    href: "/fantasy/news",
    label: "Scout",
    match: (p: string) => p.startsWith("/fantasy/news") || p.startsWith("/fantasy/scout"),
  },
] as const;

export function FantasySubNav() {
  const pathname = usePathname() || "/fantasy";
  return (
    <nav
      aria-label="Fantasy"
      style={{ display: "flex", gap: 4, borderBottom: `1px solid ${LINE}`, marginBottom: 14 }}
    >
      {TABS.map((t) => {
        const on = t.match(pathname);
        const style: CSSProperties = {
          padding: "9px 16px",
          fontSize: 14,
          fontWeight: on ? 700 : 500,
          color: on ? INK : MUTED,
          textDecoration: "none",
          borderBottom: `2px solid ${on ? TEAL : "transparent"}`,
          marginBottom: -1,
        };
        return (
          <Link key={t.href} href={t.href} style={style} aria-current={on ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
