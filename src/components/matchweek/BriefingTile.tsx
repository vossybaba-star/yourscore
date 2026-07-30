"use client";

/**
 * The Daily Briefing tile — the thing at the top of the PL news feed.
 *
 * It is deliberately NOT an article card. An article card is one outlet's story;
 * this is the day, and it has to read as a different KIND of thing or it just
 * looks like the feed's first item. Hence the label, the accent border, and a
 * SQUARE thumbnail on the right rather than the full-width 16:9 an article card
 * uses — same picture language, different shape, so it reads as a summary of the
 * day rather than one more story.
 *
 * Tapping routes to /matchweek/briefing rather than opening the half-view sheet.
 * The sheet exists to save a reader from a browser tab; a briefing is ours, it
 * scrolls, and it deserves a URL a reader can come back to and share.
 */

import Link from "next/link";
import { useState } from "react";
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

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
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
        </div>

        {/* The lead story's picture — the same one the page opens on, so the tap
            lands somewhere that looks like where it came from. */}
        <TileThumb src={leadImage(briefing)} />
      </div>
    </Link>
  );
}

/** The first story that actually shipped a picture. The lead usually has one,
 *  but six of the nine desks drop theirs some of the time, and an empty box on
 *  the tile looks like a broken tile rather than a missing photo. */
function leadImage(briefing: PlBriefing): string | null {
  return briefing.stories.find((s) => s.image)?.image ?? null;
}

/** Square, 66px. Collapses entirely if the image fails, letting the text reflow
 *  to full width rather than leaving a hole. */
function TileThumb({ src }: { src: string | null }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <div style={{
      flex: "0 0 auto", width: 66, height: 66, borderRadius: 10,
      overflow: "hidden", background: "#0b100e",
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setOk(false)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
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
