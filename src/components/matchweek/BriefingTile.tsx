"use client";

/**
 * The Daily Briefing tile — the thing at the top of the PL news feed.
 *
 * It is deliberately NOT an article card. An article card is one outlet's story;
 * this is the day, and it has to read as a different KIND of thing or it just
 * looks like the feed's first item. Hence the label, the border, and no
 * thumbnail: the tile sells the day's shape, the page carries the pictures.
 *
 * Tapping routes to /matchweek/briefing rather than opening the half-view sheet.
 * The sheet exists to save a reader from a browser tab; a briefing is ours, it
 * scrolls, and it deserves a URL a reader can come back to and share.
 */

import Link from "next/link";
import type { PlBriefing } from "@/lib/pl/briefing";

const TEAL = "#00d8c0";
const PANEL = "#141b18";
const INK = "#e8ede9";
const MUTED = "#8a948f";

export function BriefingTile({ briefing, now }: { briefing: PlBriefing; now: number }) {
  return (
    <Link
      href="/matchweek/briefing"
      className="ys-brieftile"
      style={{
        display: "block", textDecoration: "none",
        background: PANEL,
        border: `1px solid ${TEAL}33`,
        borderRadius: 14,
        padding: "13px 14px 14px",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <style>{`
        .ys-brieftile { transition: border-color 160ms cubic-bezier(.22,1,.36,1); }
        @media (hover: hover) { .ys-brieftile:hover { border-color: ${TEAL}77; } }
        .ys-brieftile:active { border-color: ${TEAL}aa; }
        @media (prefers-reduced-motion: reduce) { .ys-brieftile { transition: none } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <span style={{
          color: TEAL, fontSize: 10.5, fontWeight: 700,
          letterSpacing: 0.8, textTransform: "uppercase",
        }}>
          Daily Briefing
        </span>
        <span aria-hidden="true" style={{ color: "#3d453f" }}>·</span>
        {/* The briefing's OWN date, not today's. When the morning cron hasn't
            run yet the reader gets yesterday's, and it must say so. */}
        <span style={{ color: MUTED, fontSize: 11 }}>{dayLabel(briefing.date, now)}</span>
      </div>

      <div style={{ color: INK, fontSize: 16, lineHeight: 1.3, fontWeight: 700 }}>
        {briefing.subhead}
      </div>

      <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>
        {briefing.stories.length} {briefing.stories.length === 1 ? "story" : "stories"} ·
        {" "}Tap to read
      </div>
    </Link>
  );
}

/** "Today" / "Yesterday" / "Mon 28 Jul" — a briefing has to be honest about
 *  which day it is describing. */
export function dayLabel(date: string, now: number): string {
  const today = londonDay(new Date(now));
  if (date === today) return "Today";
  const yest = londonDay(new Date(now - 86_400_000));
  if (date === yest) return "Yesterday";
  // Parse as UTC noon so the label can't slip a day across a timezone boundary.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London",
  });
}

function londonDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
