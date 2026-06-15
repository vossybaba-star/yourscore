"use client";

/**
 * Shared 38-0 sub-navigation. Gives every Draft XI screen the same lateral row
 * (Live / Leaderboard / Leagues / Teams) so the modes are peers you can hop
 * between, instead of each page having a lone back-link. Highlights the active
 * tab from the path.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { League } from "@/lib/draft/types";

const TABS = [
  { href: "/38-0/live", label: "⚡ Live", match: "/38-0/live", color: "#aeea00" },
  { href: "/38-0/leaderboard", label: "🏆 Board", match: "/38-0/leaderboard", color: "#ffb800" },
  { href: "/38-0/leagues", label: "🏟 Leagues", match: "/38-0/leagues", color: "#aeea00" },
  { href: "/38-0/teams", label: "📁 Teams", match: "/38-0/teams", color: "#aeea00" },
];

// Keep the active competition in the URL as you hop between 38-0 sub-pages, so a La
// Liga session doesn't silently drop you onto the Premier League boards.
export function DraftHeader({ competition = "PL" }: { competition?: League }) {
  const path = usePathname() ?? "";
  const q = competition === "PL" ? "" : `?competition=${competition}`;
  return (
    <div className="flex items-center gap-2 pt-4 pb-3">
      <Link href="/38-0" className="font-body text-sm shrink-0" style={{ color: "#8a948f" }}>← 38-0</Link>
      <div className="flex items-center gap-1.5 overflow-x-auto ml-auto" style={{ scrollbarWidth: "none" }}>
        {TABS.map((t) => {
          const active =
            path.startsWith(t.match) ||
            (t.match === "/38-0/leagues" && path.startsWith("/38-0/league"));
          return (
            <Link
              key={t.href}
              href={`${t.href}${q}`}
              className="font-body text-xs px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{ color: active ? "#04130a" : t.color, background: active ? t.color : `${t.color}1a` }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
