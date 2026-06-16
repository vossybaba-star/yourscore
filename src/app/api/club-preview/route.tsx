/**
 * /api/club-preview — a branded Club League board image (1200x630) for partner
 * outreach. Drop the URL straight into a cold email as an inline <img> and the
 * pub/creator/sponsor sees THEIR league the moment they open it.
 *
 * It's a mock-up, not live data: the standings are illustrative ("what your
 * league could look like"), so it works for prospects who don't have a league
 * yet and needs no DB. Personalise per recipient via query params:
 *
 *   /api/club-preview?pub=The%20Red%20Lion&color=c8102e&logo=https://…/crest.png&prize=£50%20bar%20tab
 *
 *   pub    — venue / creator / brand name (default "Your Venue")
 *   color  — brand colour, hex with or without '#', 3 or 6 digits (default YourScore purple)
 *   logo   — optional logo/crest image URL (falls back to the name's initial)
 *   prize  — optional quiz-night prize line (default "£50 bar tab")
 *   kind   — "pub" | "creator" | "sponsor" — tweaks the pitch line (default "pub")
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const DEFAULT_ACCENT = "a78bfa"; // YourScore purple

// Parse a 3/6-digit hex (with or without '#') → {r,g,b}, or null if invalid.
function parseHex(input: string | null): { r: number; g: number; b: number } | null {
  if (!input) return null;
  let h = input.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const PITCH: Record<string, string> = {
  pub: "Your regulars, one league table — and quiz nights that keep them coming back.",
  creator: "Your community, one league table — events and bragging rights all season.",
  sponsor: "Your brand, one league table — an always-on home for the fans you reach.",
};

// Illustrative standings — clearly "what your league could look like".
const ROWS = [
  { initials: "DK", name: "Dave K.", record: "9W · 2D · 1L", pts: "14,820", from: "#3a423d", fg: "#aeea00" },
  { initials: "SM", name: "Sarah M.", record: "7W · 4D · 2L", pts: "13,140", from: "#1a4a2a", fg: "#4ade80" },
  { initials: "TP", name: "Tom P.", record: "6W · 5D · 1L", pts: "11,990", from: "#1a2f4a", fg: "#60a5fa" },
  { initials: "LH", name: "Liam H.", record: "5W · 6D · 1L", pts: "10,540", from: "#4a2a1a", fg: "#fb923c" },
  { initials: "PS", name: "Priya S.", record: "4W · 5D · 3L", pts: "9,310", from: "#4a1a2a", fg: "#f87171" },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pub = (searchParams.get("pub") || "Your Venue").slice(0, 40);
  const prize = (searchParams.get("prize") || "£50 bar tab").slice(0, 40);
  const logo = searchParams.get("logo");
  const wallpaper = searchParams.get("wallpaper");
  const kind = searchParams.get("kind") || "pub";

  const rgb = parseHex(searchParams.get("color")) ?? parseHex(DEFAULT_ACCENT)!;
  const accent = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  const accentDim = `rgba(${rgb.r},${rgb.g},${rgb.b},0.14)`;
  const accentBorder = `rgba(${rgb.r},${rgb.g},${rgb.b},0.45)`;
  const initial = (pub.trim()[0] || "Y").toUpperCase();
  const pitch = PITCH[kind] ?? PITCH.pub;

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "#0a0a0f", fontFamily: "sans-serif", position: "relative", padding: "52px 60px" }}>
        {/* immersive brand takeover: the venue's own image as a dimmed full-bleed
            backdrop, tinted toward their colour, behind a dark scrim for legibility. */}
        {wallpaper ? (
          <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: "1200px", height: "630px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={wallpaper} width={1200} height={630} alt="" style={{ width: "1200px", height: "630px", objectFit: "cover", opacity: 0.28 }} />
            <div style={{ position: "absolute", top: 0, left: 0, width: "1200px", height: "630px", background: "linear-gradient(120deg, rgba(10,10,15,0.97) 30%, rgba(10,10,15,0.62) 100%)" }} />
            <div style={{ position: "absolute", top: 0, left: 0, width: "1200px", height: "630px", background: accentDim }} />
          </div>
        ) : null}

        {/* top row: wordmark + CLUB LEAGUE badge */}
        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={205} height={55} alt="YourScore" style={{ display: "flex" }} />
          <div style={{ display: "flex", padding: "9px 22px", borderRadius: 999, background: accentDim, border: `1px solid ${accentBorder}` }}>
            <span style={{ display: "flex", color: accent, fontSize: 23, fontWeight: 800, letterSpacing: 3 }}>CLUB LEAGUE</span>
          </div>
        </div>

        {/* body: identity (left) + board (right) */}
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: 48, paddingTop: 40 }}>

          {/* left — pub identity + pitch + quiz-night pill */}
          <div style={{ display: "flex", flexDirection: "column", width: 470, gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 92, height: 92, borderRadius: 22, background: "#0e1611", border: `2px solid ${accentBorder}`, overflow: "hidden" }}>
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} width={92} height={92} alt="" style={{ display: "flex", objectFit: "cover" }} />
                ) : (
                  <span style={{ display: "flex", fontSize: 50, fontWeight: 800, color: accent }}>{initial}</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", color: accent, fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>CLUB LEAGUE</span>
                <span style={{ display: "flex", color: "#8a948f", fontSize: 21, fontWeight: 600 }}>24 members</span>
              </div>
            </div>

            <div style={{ display: "flex", height: 116, alignItems: "flex-start" }}>
              <span style={{ display: "flex", color: "#ffffff", fontSize: 56, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>{pub}</span>
            </div>

            <span style={{ display: "flex", color: "#c4ccc6", fontSize: 24, fontWeight: 500, lineHeight: 1.35 }}>{pitch}</span>

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderRadius: 14, background: accentDim, border: `1px solid ${accentBorder}` }}>
              <span style={{ display: "flex", fontSize: 26 }}>🏆</span>
              <span style={{ display: "flex", color: "#ffffff", fontSize: 23, fontWeight: 600 }}>Quiz night — winner takes the {prize}</span>
            </div>
          </div>

          {/* right — the board */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 9 }}>
            <span style={{ display: "flex", color: "#8a948f", fontSize: 18, fontWeight: 700, letterSpacing: 2, paddingBottom: 4 }}>CLUB TABLE</span>
            {ROWS.map((row, i) => {
              const top = i === 0;
              return (
                <div key={row.initials} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderRadius: 14, background: top ? accentDim : "#0e1611", border: `1px solid ${top ? accentBorder : "rgba(255,255,255,0.07)"}` }}>
                  <span style={{ display: "flex", width: 26, justifyContent: "center", color: top ? accent : "#8a948f", fontSize: 22, fontWeight: 800 }}>{i + 1}</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 999, background: row.from }}>
                    <span style={{ display: "flex", color: row.fg, fontSize: 18, fontWeight: 700 }}>{row.initials}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 2 }}>
                    <span style={{ display: "flex", color: "#ffffff", fontSize: 23, fontWeight: 600 }}>{row.name}</span>
                    <span style={{ display: "flex", color: "#8a948f", fontSize: 16, fontWeight: 500 }}>{row.record}</span>
                  </div>
                  <span style={{ display: "flex", color: top ? accent : "#c4ccc6", fontSize: 26, fontWeight: 800 }}>{row.pts}</span>
                </div>
              );
            })}
            <span style={{ display: "flex", color: "#3a423d", fontSize: 15, fontWeight: 500, paddingTop: 4 }}>YourScore points — match wins + quiz knowledge, one table</span>
          </div>
        </div>

        {/* accent base line */}
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      emoji: "twemoji",
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    }
  );
}
