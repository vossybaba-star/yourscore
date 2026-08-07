"use client";
/**
 * The Fantasy tab's top chrome — one big title + a segmented section bar, the
 * SAME shape the Premier League tab wears (big "PREMIER LEAGUE" + News/Table/
 * Fixtures pills). Replaces the old small teal wordmark Header and the separate
 * "← Fantasy" masthead on the Scout pages, so Squad ⇄ Scout reads as switching a
 * tab, not opening a different page.
 *
 * The pills are <Link>s (App-Router soft navigation, no full reload) but styled
 * as the PL section pills and rendered identically on both sides, so the chrome
 * never changes underneath the switch. Active by pathname.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const INK = "#eef2f0";
const MUTED = "#8a948f";

// Fantasy is "my team" — three tabs (product model 2026-08-07): Home · Squad ·
// Scout. Leagues moved to the global bottom-nav Leagues tab ("my people"); the
// social feed moved to the global Home ("football happening"). /fantasy/social
// and /fantasy/leagues stay routable for deep links — they are just no longer
// pills here (Social posts open with no fantasy pill lit, which is correct: the
// feed belongs to Home now).
const TABS = [
  { href: "/fantasy", label: "Home", accent: TEAL, match: (p: string) => p === "/fantasy" },
  { href: "/fantasy/squad", label: "Squad", accent: LIME, match: (p: string) => p === "/fantasy/squad" },
  {
    href: "/fantasy/news",
    label: "Scout",
    accent: TEAL,
    match: (p: string) => p.startsWith("/fantasy/news") || p.startsWith("/fantasy/scout"),
  },
] as const;

export function FantasyHeader({ subtitle }: { subtitle?: string }) {
  const pathname = usePathname() || "/fantasy";
  // No tab is gated to view (founder, 4 Aug): a signed-out visitor can open every
  // Fantasy tab — Home, Squad, Social, Leagues, Scout — and even build a team. The
  // only thing an account unlocks is SAVING (a squad, a league), gated at the point
  // of action, not the door.
  const hrefFor = (href: string) => href;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div>
          <h1 className="font-display" style={{ fontSize: 27, color: INK, lineHeight: 1, letterSpacing: "-0.005em", margin: 0 }}>
            YourScore Fantasy PL
          </h1>
          {subtitle && (
            <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "6px 0 0" }}>{subtitle}</p>
          )}
        </div>
        {/* Notifications entry point (Social/Leagues had none — the bell on
            the home dashboard was the only door to /notifications). Same
            glyph as Dashboard's nav bell; no unread dot here since that needs
            a fetch this header doesn't already make — plain link only. */}
        <Link href="/notifications" aria-label="Notifications" style={{
          flexShrink: 0, marginTop: 1, width: 36, height: 36, borderRadius: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.1)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </Link>
      </div>
      <div style={{
        display: "flex", gap: 4, padding: 4, borderRadius: 16,
        background: "rgba(255,255,255,0.04)", marginTop: 12,
      }}>
        {TABS.map((t) => {
          const on = t.match(pathname);
          return (
            <Link key={t.href} href={hrefFor(t.href)} aria-current={on ? "page" : undefined}
              className="font-display"
              style={{
                flex: 1, textAlign: "center", padding: "9px 3px", borderRadius: 12,
                fontSize: 14.5, fontWeight: 700, letterSpacing: 0, textDecoration: "none",
                background: on ? t.accent : "transparent", color: on ? "#062018" : MUTED,
                whiteSpace: "nowrap",
              }}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
