"use client";

/**
 * The Daily Briefing, in full.
 *
 * Three parts, in the order a reader wants them:
 *   1. What today is about — the compiled subhead.
 *   2. What happened — our bullets, one per story.
 *   3. Where it came from — the five articles, thumbnail and link.
 *
 * We publish no reporting of our own, so the sources are not a footnote. Every
 * bullet is numbered to the story it summarises and the list below carries the
 * same numbers, which is what makes "read it at the source" a real offer rather
 * than a link dump at the bottom.
 */

import { useState } from "react";
import { BackPill } from "@/components/ui/BackPill";
import { dayLabel } from "@/components/matchweek/BriefingTile";
import { bulletSegments, type PlBriefing } from "@/lib/pl/briefing";

const TEAL = "#00d8c0";
const PANEL = "#141b18";
const LINE = "rgba(255,255,255,0.08)";
const INK = "#e8ede9";
const MUTED = "#8a948f";

export function BriefingView({ briefing }: { briefing: PlBriefing | null }) {
  // Captured once so every relative label on the page agrees on one clock.
  const [now] = useState(() => Date.now());

  if (!briefing || briefing.stories.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4" style={{ display: "grid", gap: 14 }}>
        {/* A flex row, not justifySelf: the pill computes to `display: flex`
            rather than the inline-flex its class asks for, so it fills whatever
            it is given. A flex parent sizes it to its content. */}
        <div style={{ display: "flex" }}>
          <BackPill fallback="/matchweek" tone="play" />
        </div>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }}>
          <div style={{ color: INK, fontSize: 15, fontWeight: 700 }}>No briefing yet</div>
          <div style={{ color: MUTED, fontSize: 13.5, marginTop: 7, lineHeight: 1.5 }}>
            The day&rsquo;s biggest stories are compiled each morning. Check back shortly.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 pb-10" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex" }}>
        <BackPill fallback="/matchweek" tone="play" />
      </div>

      <header>
        <div style={{
          color: TEAL, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.9, textTransform: "uppercase",
        }}>
          Daily Briefing
        </div>
        <h1 style={{ color: INK, fontSize: 25, lineHeight: 1.22, fontWeight: 800, margin: "8px 0 0" }}>
          {briefing.subhead}
        </h1>
        <div style={{ color: MUTED, fontSize: 12.5, marginTop: 9 }}>
          {dayLabel(briefing.date, now)} · {briefing.stories.length} stories
        </div>
      </header>

      {/* The summary. Bullet then picture, bullet then picture — it should read
          the way an article reads as you scroll, not like a list with a gallery
          bolted on. The number still ties each one to its source below. */}
      <ol style={{ display: "grid", gap: 20, margin: 0, padding: 0, listStyle: "none" }}>
        {briefing.stories.map((s, i) => (
          <li key={`b${s.id}`} style={{ display: "grid", gap: 11 }}>
            <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 auto", width: 20, height: 20, borderRadius: 999,
                  background: `${TEAL}1e`, color: TEAL,
                  fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginTop: 3,
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: "#c9d1cc", fontSize: 15, lineHeight: 1.55 }}>
                {bulletSegments(s.bullet).map((seg, j) =>
                  seg.bold
                    ? <strong key={j} style={{ color: INK, fontWeight: 700 }}>{seg.text}</strong>
                    : <span key={j}>{seg.text}</span>,
                )}
              </span>
            </span>

            {/* The article's own picture. Tappable, because a full-width image
                mid-scroll is the thing a reader reaches for — the list below
                stays as the explicit index of sources. */}
            {s.image && <BulletImage src={s.image} href={s.url} source={s.source} />}
          </li>
        ))}
      </ol>

      <div style={{ height: 1, background: LINE }} />

      <section style={{ display: "grid", gap: 10 }}>
        <h2 style={{ color: MUTED, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", margin: 0 }}>
          Read the stories
        </h2>

        {briefing.stories.map((s, i) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ys-briefsrc"
            style={{
              display: "flex", gap: 11, alignItems: "center",
              background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12,
              padding: 9, textDecoration: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Thumb src={s.image} n={i + 1} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{
                display: "block", color: INK, fontSize: 13.5, lineHeight: 1.35,
                fontWeight: 600,
              }}>
                {s.title}
              </span>
              <span style={{ display: "block", color: TEAL, fontSize: 11, fontWeight: 600, marginTop: 5 }}>
                {s.source}
                {/* Why this one made the briefing. A story five desks ran is the
                    only "biggest" signal we have, so we show our working. */}
                {s.desks > 1 && (
                  <span style={{ color: MUTED, fontWeight: 400 }}> · {s.desks} desks</span>
                )}
              </span>
            </span>
            <span aria-hidden="true" style={{ color: MUTED, fontSize: 15, flex: "0 0 auto", paddingRight: 3 }}>↗</span>
          </a>
        ))}
      </section>

      <p style={{ color: "#5c655f", fontSize: 11.5, lineHeight: 1.5, margin: 0 }}>
        Headlines and summaries are the outlets&rsquo; own. YourScore compiles, it
        does not report. Tap any story to read it at the source.
      </p>

      <style>{`
        .ys-briefsrc { transition: border-color 160ms cubic-bezier(.22,1,.36,1); }
        @media (hover: hover) { .ys-briefsrc:hover { border-color: ${TEAL}55; } }
        .ys-briefsrc:active { border-color: ${TEAL}88; }
        @media (prefers-reduced-motion: reduce) { .ys-briefsrc { transition: none } }
      `}</style>
    </div>
  );
}

/**
 * The full-width picture under a bullet.
 *
 * Collapses to nothing if the image 404s. An empty 16:9 box mid-scroll breaks
 * the article rhythm far worse than the missing picture does — six of the nine
 * desks drop their image some of the time.
 */
function BulletImage({ src, href, source }: { src: string; href: string; source: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Read this story at ${source}`}
      style={{
        display: "block", position: "relative", aspectRatio: "16 / 9",
        borderRadius: 12, overflow: "hidden", background: "#0b100e",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setOk(false)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {/* Whose picture it is. An uncredited photo in our own layout reads as
          ours, and none of them are. */}
      <span
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          padding: "20px 10px 7px",
          fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
          color: "rgba(255,255,255,0.9)",
          textShadow: "0 1px 4px rgba(0,0,0,0.9)",
          background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
        }}
      >
        {source}
      </span>
    </a>
  );
}

/** Square thumbnail. Falls back to the story's number rather than a broken
 *  image or a ragged row — six desks in nine ship no picture some of the time. */
function Thumb({ src, n }: { src: string | null; n: number }) {
  const [ok, setOk] = useState(true);
  const box: React.CSSProperties = {
    flex: "0 0 auto", width: 62, height: 62, borderRadius: 9,
    overflow: "hidden", background: "#0b100e",
  };
  if (!src || !ok) {
    return (
      <span style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", color: `${TEAL}88`, fontSize: 17, fontWeight: 800 }}>
        {n}
      </span>
    );
  }
  return (
    <span style={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setOk(false)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </span>
  );
}
