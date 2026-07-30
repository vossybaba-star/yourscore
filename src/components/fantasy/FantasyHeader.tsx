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
const INK = "#eef2f0";
const MUTED = "#8a948f";

const TABS = [
  { href: "/fantasy", label: "Squad", match: (p: string) => p === "/fantasy" },
  {
    href: "/fantasy/news",
    label: "Scout",
    match: (p: string) => p.startsWith("/fantasy/news") || p.startsWith("/fantasy/scout"),
  },
  { href: "/fantasy/leagues", label: "Leagues", match: (p: string) => p.startsWith("/fantasy/leagues") },
] as const;

export function FantasyHeader({ subtitle }: { subtitle?: string }) {
  const pathname = usePathname() || "/fantasy";
  return (
    <div style={{ marginBottom: 14 }}>
      <h1 className="font-display" style={{ fontSize: 27, color: INK, lineHeight: 1, letterSpacing: "-0.005em", margin: 0 }}>
        YourScore Fantasy PL
      </h1>
      {subtitle && (
        <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "6px 0 0" }}>{subtitle}</p>
      )}
      <div style={{
        display: "flex", gap: 6, padding: 4, borderRadius: 16,
        background: "rgba(255,255,255,0.04)", marginTop: 12,
      }}>
        {TABS.map((t) => {
          const on = t.match(pathname);
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
              className="font-display"
              style={{
                flex: 1, textAlign: "center", padding: "9px 6px", borderRadius: 12,
                fontSize: 13.5, fontWeight: 700, letterSpacing: "0.01em", textDecoration: "none",
                background: on ? TEAL : "transparent", color: on ? "#062018" : MUTED,
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
