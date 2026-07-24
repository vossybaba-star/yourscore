/**
 * /api/og/higher-lower — the Higher or Lower link-preview card (1200x630).
 *
 * The card IS the question. A scroller sees the actual first question of
 * today's pinned round (two same-position Premier League players, one stat)
 * and can answer it in their head before they tap. That is the hook: a generic
 * "play Higher or Lower" card asks for a click, this one starts the game in
 * the timeline.
 *
 * TODAY'S PINNED ROUND, NOT A RANDOM ONE. The round is rebuilt from
 * dailySeed() — the same deterministic London-date seed the game serves for
 * `?daily=1` — so the two players on the card are exactly the two the player
 * gets when they tap. A random round would be a broken promise twice over: X
 * caches the scraped image, so the card would freeze on whichever round was
 * drawn first and then never match anything.
 *
 * NO NUMBERS ON THE CARD. The pool's `meta` carries both players' stat values;
 * those are the answer and never leave this function. The card shows the two
 * names and a pair of blanks. Same no-spoiler rule the Perfect 10 card follows.
 *
 * Q1 is the EASIEST of the ten (buildRound sorts easy → hard), which is what a
 * hook wants: a casual fan should back themselves from the timeline.
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";
import { buildRound, clientRound, dailySeed } from "@/lib/games/serve";
import { londonDateISO } from "@/lib/games/londonDate";

export const runtime = "edge";

const ORANGE = "#ff7800";
const INK = "#0b0d0f";

/** Long surnames ("Ortega Moreno", "Lewis-Skelly") must not wrap the panel. */
function nameSize(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest <= 8) return 74;
  if (longest <= 11) return 62;
  if (longest <= 14) return 52;
  return 44;
}

/** "2026-07-24" → "24 JUL" for the today chip. */
function dayLabel(iso: string): string {
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const [, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  return `${Number(d)} ${month}`;
}

function Player({ name, size }: { name: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        width: 452,
        height: 268,
        borderRadius: 26,
        background: "rgba(255,255,255,0.04)",
        border: "1.5px solid rgba(255,120,0,0.32)",
        boxShadow: "0 0 44px rgba(255,120,0,0.10)",
      }}
    >
      <span
        style={{
          display: "flex",
          color: "#ffffff",
          fontSize: size,
          fontWeight: 900,
          letterSpacing: -1.5,
          textAlign: "center",
        }}
      >
        {name}
      </span>
      {/* Where the number goes. Blanked, because the number is the answer. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", width: 30, height: 7, borderRadius: 4, background: "rgba(255,120,0,0.38)" }} />
        <div style={{ display: "flex", width: 30, height: 7, borderRadius: 4, background: "rgba(255,120,0,0.38)" }} />
        <div style={{ display: "flex", width: 30, height: 7, borderRadius: 4, background: "rgba(255,120,0,0.38)" }} />
      </div>
    </div>
  );
}

export function GET() {
  const today = londonDateISO();
  const [q] = clientRound(buildRound("higher-lower", dailySeed(today)));

  // The pool is shipped with the build, so a missing Q1 means the pool itself
  // is empty — fall back to a promo card rather than 500 the unfurl.
  const prompt = q?.prompt ?? "Two players, one stat. Pick the bigger number.";
  const a = q?.options?.[0]?.label ?? "";
  const b = q?.options?.[1]?.label ?? "";
  const position = q?.position ?? "";
  const size = nameSize(a, b);

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `linear-gradient(150deg, #1a1005 0%, ${INK} 55%, #0a0a0f 100%)`,
          fontFamily: "sans-serif",
          position: "relative",
          padding: "38px 54px 46px",
        }}
      >
        {/* orange wash behind the pair */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "1200px",
            height: "630px",
            display: "flex",
            background: "radial-gradient(58% 62% at 50% 52%, rgba(255,120,0,0.15) 0%, rgba(255,120,0,0) 65%)",
          }}
        />

        {/* ── header: brand + game + today ──────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={152} height={41} alt="YourScore" style={{ display: "flex" }} />
            <div
              style={{
                display: "flex",
                padding: "7px 18px",
                borderRadius: 999,
                background: "rgba(255,120,0,0.14)",
                border: `1px solid ${ORANGE}80`,
              }}
            >
              <span style={{ display: "flex", color: ORANGE, fontSize: 20, fontWeight: 800, letterSpacing: 2.5 }}>
                HIGHER OR LOWER
              </span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "7px 18px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.13)",
            }}
          >
            <span style={{ display: "flex", color: "#c4ccc6", fontSize: 19, fontWeight: 800, letterSpacing: 2 }}>
              TODAY · {dayLabel(today)}
            </span>
          </div>
        </div>

        {/* ── the question ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <span
            style={{
              display: "flex",
              color: "#ffffff",
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: -0.8,
              textAlign: "center",
              maxWidth: 1000,
            }}
          >
            {prompt}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <Player name={a} size={size} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 78,
                height: 78,
                borderRadius: "50%",
                background: ORANGE,
                boxShadow: "0 0 40px rgba(255,120,0,0.45)",
              }}
            >
              <span style={{ display: "flex", color: INK, fontSize: 30, fontWeight: 900, letterSpacing: 1 }}>VS</span>
            </div>
            <Player name={b} size={size} />
          </div>
        </div>

        {/* ── footer: position + call ───────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {position ? (
            <div
              style={{
                display: "flex",
                padding: "11px 24px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.13)",
              }}
            >
              <span style={{ display: "flex", color: "#c4ccc6", fontSize: 25, fontWeight: 700 }}>
                Both {position.toLowerCase()} · question 1 of 10
              </span>
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", padding: "15px 32px", borderRadius: 999, background: ORANGE }}>
            <span style={{ display: "flex", color: INK, fontSize: 29, fontWeight: 900, letterSpacing: 1 }}>
              PICK THE BIGGER NUMBER →
            </span>
          </div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 9, display: "flex", background: ORANGE }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      // The card turns over at London midnight with the pinned round, so let a
      // scraper hold it for an hour but never longer than the day it shows.
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" },
    }
  );
}
