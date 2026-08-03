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
import { useUser } from "@/hooks/useUser";

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const GOLD = "#ffc233";
const INK = "#eef2f0";
const MUTED = "#8a948f";

// Each area carries its own accent so the tab you're on is colour-coded: Home,
// Scout and Social teal (the feed/radar/knowledge brand), Squad lime, Leagues
// gold. Social is now a first-class destination — the feed no longer hides
// behind a Home sub-toggle (founder, 3 Aug).
// Order (founder, 3 Aug): Home · Squad · Social · Leagues · Scout.
const TABS = [
  { href: "/fantasy", label: "Home", accent: TEAL, match: (p: string) => p === "/fantasy" },
  { href: "/fantasy/squad", label: "Squad", accent: LIME, match: (p: string) => p === "/fantasy/squad" },
  // Social owns both /fantasy/social and the legacy /fantasy/feed (which now
  // redirects here), so the old feed deep-links light the Social tab.
  { href: "/fantasy/social", label: "Social", accent: TEAL, match: (p: string) => p.startsWith("/fantasy/social") || p.startsWith("/fantasy/feed") },
  { href: "/fantasy/leagues", label: "Leagues", accent: GOLD, match: (p: string) => p.startsWith("/fantasy/leagues") },
  {
    href: "/fantasy/news",
    label: "Scout",
    accent: TEAL,
    match: (p: string) => p.startsWith("/fantasy/news") || p.startsWith("/fantasy/scout"),
  },
] as const;

export function FantasyHeader({ subtitle }: { subtitle?: string }) {
  const pathname = usePathname() || "/fantasy";
  const { user } = useUser();
  // Fantasy PL isn't gated to view (founder, 3 Aug): Home, Scout and Social are all
  // browsable signed-out — you just can't contribute without an account. Squad and
  // Leagues are personal tools, so those still route a guest through sign-in.
  const publicHref = (href: string) => href === "/fantasy" || href === "/fantasy/news" || href === "/fantasy/social";
  const hrefFor = (href: string) => (!user && !publicHref(href)) ? `/auth/sign-in?next=${encodeURIComponent(href)}` : href;
  return (
    <div style={{ marginBottom: 14 }}>
      <h1 className="font-display" style={{ fontSize: 27, color: INK, lineHeight: 1, letterSpacing: "-0.005em", margin: 0 }}>
        YourScore Fantasy PL
      </h1>
      {subtitle && (
        <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "6px 0 0" }}>{subtitle}</p>
      )}
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
                // Five tabs now, so a touch tighter than the old four to keep
                // "Leagues" on one line at 375px.
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
