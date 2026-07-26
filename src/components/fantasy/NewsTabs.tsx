/**
 * Tab strip shared by /fantasy/news and /fantasy/fixtures.
 *
 * Why the split: the news page is a FEED — a stream of content cards you scroll
 * and tap into (team news, articles, tweets, tips). The fixture ticker is
 * REFERENCE DATA — a 20×5 grid you consult when planning a transfer, not
 * something you browse. It shipped at the top of the feed once and buried the
 * content people actually came for. Reference tools get their own tab.
 *
 * Server component (plain links) so both pages stay ISR — no client JS.
 */
import Link from "next/link";
import type { CSSProperties } from "react";

// Shared fantasy tokens (mirrored, not imported — shared.tsx is "use client").
const TEAL = "#00d8c0";
const INK = "#eef2f0";
const MUTED = "#8a948f";
const LINE = "rgba(255,255,255,0.07)";

const TABS = [
  { href: "/fantasy/news", label: "Fantasy tips" },
  { href: "/fantasy/fixtures", label: "Difficulty" },
] as const;

export type NewsTab = (typeof TABS)[number]["href"];

export function NewsTabs({ active }: { active: NewsTab }) {
  return (
    <nav
      aria-label="Fantasy news"
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
      <span style={{ flex: 1 }} />
      <span style={{ color: INK, fontSize: 0 }} aria-hidden="true" />
    </nav>
  );
}
