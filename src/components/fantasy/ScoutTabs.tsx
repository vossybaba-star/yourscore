/**
 * Scout tab strip — Briefing / Players / Shortlist.
 *
 * A dedicated strip rather than a change to NewsTabs: NewsTabs is shared with
 * /fantasy/fixtures (the difficulty ticker), and repurposing it would strip that
 * page's own tabs. Same visual language as NewsTabs (server component, plain
 * links, teal underline on the active tab) so the two read as one system.
 *
 * Briefing lives on the EXISTING /fantasy/news route (unchanged, so nothing that
 * links there breaks). Players and Shortlist are stage-1 placeholders.
 */
import Link from "next/link";
import type { CSSProperties } from "react";

// Shared fantasy tokens (mirrored, not imported — shared.tsx is "use client").
const TEAL = "#00d8c0";
const INK = "#eef2f0";
const MUTED = "#8a948f";
const LINE = "rgba(255,255,255,0.07)";

const TABS = [
  { href: "/fantasy/news", label: "Briefing" },
  { href: "/fantasy/scout/players", label: "Players" },
  { href: "/fantasy/scout/shortlist", label: "Shortlist" },
] as const;

export type ScoutTab = (typeof TABS)[number]["href"];

export function ScoutTabs({ active }: { active: ScoutTab }) {
  return (
    <nav
      aria-label="Scout"
      style={{ display: "flex", gap: 4, borderBottom: `1px solid ${LINE}` }}
    >
      {TABS.map((t) => {
        const on = t.href === active;
        const style: CSSProperties = {
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: on ? 600 : 400,
          color: on ? INK : MUTED,
          textDecoration: "none",
          borderBottom: `2px solid ${on ? TEAL : "transparent"}`,
          marginBottom: -1,
        };
        return (
          <Link
            key={t.href}
            href={t.href}
            style={style}
            aria-current={on ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
