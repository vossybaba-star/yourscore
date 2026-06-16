/**
 * /api/club-preview — branded Club League visuals for partner outreach.
 *
 * Default (no `screen`): a 1200x630 landscape board card (good inline-email hero).
 * `screen=hub|board|win`: a portrait (860x1530) app-screen mockup — the three-up
 * story for a pitch: the pub's branded home, the league table, and a regular
 * winning the pub's prize. All are mock-ups (illustrative standings), so they work
 * for prospects with no league yet and need no DB.
 *
 * Shared params: pub, color (hex ±#), logo, wallpaper, prize, kind (pub|creator|
 * sponsor). Win screen also takes `winner` (name, default "Dave K.").
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const DEFAULT_ACCENT = "a78bfa"; // YourScore purple

function parseHex(input: string | null): { r: number; g: number; b: number } | null {
  if (!input) return null;
  let h = input.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const PITCH: Record<string, string> = {
  pub: "Your regulars, one league table — and quiz nights that keep them coming back.",
  creator: "Your community, one league table — events and bragging rights all season.",
  sponsor: "Your brand, one league table — an always-on home for the fans you reach.",
};

// Illustrative standings — "what your league could look like". `you` marks the
// viewer's own row on the board screen.
const ROWS = [
  { initials: "DK", name: "Dave K.", record: "9W · 2D · 1L", pts: "14,820", from: "#3a2f4a", fg: "#c7b3ff" },
  { initials: "SM", name: "Sarah M.", record: "7W · 4D · 2L", pts: "13,140", from: "#1a4a2a", fg: "#4ade80" },
  { initials: "TP", name: "Tom P.", record: "6W · 5D · 1L", pts: "11,990", from: "#1a2f4a", fg: "#60a5fa" },
  { initials: "YO", name: "You", record: "6W · 3D · 3L", pts: "10,910", from: "#4a2a1a", fg: "#fb923c", you: true },
  { initials: "LH", name: "Liam H.", record: "5W · 6D · 1L", pts: "10,540", from: "#2a3a4a", fg: "#7dd3fc" },
  { initials: "PS", name: "Priya S.", record: "4W · 5D · 3L", pts: "9,310", from: "#4a1a2a", fg: "#f87171" },
  { initials: "MR", name: "Marc R.", record: "3W · 6D · 3L", pts: "8,400", from: "#33402f", fg: "#bef264" },
];

const PORTRAIT = { width: 860, height: 1530 };
const LANDSCAPE = { width: 1200, height: 630 };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pub = (searchParams.get("pub") || "Your Venue").slice(0, 40);
  const prize = (searchParams.get("prize") || "£50 bar tab").slice(0, 40);
  const logo = searchParams.get("logo");
  const wallpaper = searchParams.get("wallpaper");
  const kind = searchParams.get("kind") || "pub";
  const screen = searchParams.get("screen"); // hub | board | win | (null = landscape)
  const winner = (searchParams.get("winner") || "Dave K.").slice(0, 30);

  const rgb = parseHex(searchParams.get("color")) ?? parseHex(DEFAULT_ACCENT)!;
  const accent = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  const accentDim = `rgba(${rgb.r},${rgb.g},${rgb.b},0.16)`;
  const accentSoft = `rgba(${rgb.r},${rgb.g},${rgb.b},0.10)`;
  const accentBorder = `rgba(${rgb.r},${rgb.g},${rgb.b},0.45)`;
  const initial = (pub.trim()[0] || "Y").toUpperCase();
  const pitch = PITCH[kind] ?? PITCH.pub;
  const W = screen === "hub" || screen === "board" || screen === "win" ? PORTRAIT : LANDSCAPE;

  // ── Shared bits ─────────────────────────────────────────────────────────
  const Backdrop = (full: boolean) =>
    wallpaper ? (
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: `${W.width}px`, height: `${W.height}px` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wallpaper} width={W.width} height={W.height} alt="" style={{ width: `${W.width}px`, height: `${W.height}px`, objectFit: "cover", opacity: full ? 0.3 : 0.24 }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: `${W.width}px`, height: `${W.height}px`, background: `linear-gradient(180deg, rgba(10,10,15,0.78) 0%, rgba(10,10,15,0.94) ${full ? 55 : 42}%, rgba(10,10,15,0.99) 100%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: `${W.width}px`, height: `${W.height}px`, background: accentSoft }} />
      </div>
    ) : null;

  const logoTile = (sz: number) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: sz, height: sz, borderRadius: Math.round(sz * 0.24), background: "#0e1014", border: `2px solid ${accentBorder}`, overflow: "hidden" }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} width={sz} height={sz} alt="" style={{ display: "flex", objectFit: "cover" }} />
      ) : (
        <span style={{ display: "flex", fontSize: Math.round(sz * 0.5), fontWeight: 800, color: accent }}>{initial}</span>
      )}
    </div>
  );

  const poweredBy = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.85 }}>
      <span style={{ display: "flex", color: "#7a8a82", fontSize: 20, fontWeight: 500 }}>Powered by</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_DATA_URI} width={132} height={35} alt="YourScore" style={{ display: "flex" }} />
    </div>
  );

  const boardRow = (r: (typeof ROWS)[number], pos: number, compact: boolean) => {
    const top = pos === 1;
    const hi = top || r.you;
    return (
      <div key={r.initials} style={{ display: "flex", alignItems: "center", gap: 16, padding: compact ? "14px 20px" : "16px 22px", borderRadius: 16, background: top ? accentDim : r.you ? accentSoft : "rgba(18,20,24,0.82)", border: `1px solid ${hi ? accentBorder : "rgba(255,255,255,0.08)"}` }}>
        <span style={{ display: "flex", width: 34, justifyContent: "center", color: top ? accent : "#8a948f", fontSize: 26, fontWeight: 800 }}>{pos}</span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 999, background: r.from }}>
          <span style={{ display: "flex", color: r.fg, fontSize: 21, fontWeight: 700 }}>{r.initials}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 3 }}>
          <span style={{ display: "flex", color: "#ffffff", fontSize: 27, fontWeight: 600 }}>
            {r.name}{r.you ? <span style={{ color: accent, fontSize: 19, fontWeight: 600 }}>  · you</span> : null}
          </span>
          <span style={{ display: "flex", color: "#7a8478", fontSize: 18, fontWeight: 500 }}>{r.record}</span>
        </div>
        <span style={{ display: "flex", color: top ? accent : hi ? "#fff" : "#cfcfe0", fontSize: 30, fontWeight: 800 }}>{r.pts}</span>
      </div>
    );
  };

  // ── HUB screen ──────────────────────────────────────────────────────────
  if (screen === "hub") {
    const element = (
      <div style={{ width: `${W.width}px`, height: `${W.height}px`, display: "flex", flexDirection: "column", background: "#0a0a0f", fontFamily: "sans-serif", position: "relative", padding: "44px 44px" }}>
        {Backdrop(true)}
        <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 26, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {poweredBy}
            <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: accentDim, border: `1px solid ${accentBorder}` }}>
              <span style={{ display: "flex", color: accent, fontSize: 19, fontWeight: 800, letterSpacing: 2 }}>CLUB LEAGUE</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 22, paddingTop: 8 }}>
            {logoTile(118)}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ display: "flex", color: "#ffffff", fontSize: 58, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>{pub}</span>
              <span style={{ display: "flex", color: accent, fontSize: 24, fontWeight: 700 }}>Club League · 24 members</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "20px 24px", borderRadius: 18, background: accentSoft, border: `1px solid ${accentBorder}` }}>
            <span style={{ display: "flex", color: accent, fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>📌  PINNED</span>
            <span style={{ display: "flex", color: "#ffffff", fontSize: 27, fontWeight: 500, lineHeight: 1.3 }}>Tuesday quiz night, 8pm. Winner takes the {prize}.</span>
          </div>

          <div style={{ display: "flex", gap: 8, padding: 7, borderRadius: 18, background: "rgba(255,255,255,0.05)" }}>
            {["Board", "Events", "Feed"].map((t) => (
              <div key={t} style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: "13px 0", borderRadius: 13, background: t === "Board" ? accent : "transparent" }}>
                <span style={{ display: "flex", color: t === "Board" ? "#0a0a0f" : "#8a948f", fontSize: 24, fontWeight: 700 }}>{t}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ display: "flex", color: "#7a8478", fontSize: 19, fontWeight: 700, letterSpacing: 2 }}>CLUB TABLE</span>
            {ROWS.slice(0, 4).map((r, i) => boardRow(r, i + 1, true))}
          </div>

          <span style={{ display: "flex", color: "#c4ccc6", fontSize: 23, fontWeight: 500, lineHeight: 1.35, paddingTop: 4 }}>{pitch}</span>
        </div>
        <div style={{ position: "absolute", left: 0, bottom: 0, width: `${W.width}px`, height: 10, background: accent }} />
      </div>
    );
    return new ImageResponse(element, { ...W, emoji: "twemoji", headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  }

  // ── BOARD screen ────────────────────────────────────────────────────────
  if (screen === "board") {
    const element = (
      <div style={{ width: `${W.width}px`, height: `${W.height}px`, display: "flex", flexDirection: "column", background: "#0a0a0f", fontFamily: "sans-serif", position: "relative", padding: "44px 44px" }}>
        {Backdrop(false)}
        <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 24, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {poweredBy}
            <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: accentDim, border: `1px solid ${accentBorder}` }}>
              <span style={{ display: "flex", color: accent, fontSize: 19, fontWeight: 800, letterSpacing: 2 }}>CLUB LEAGUE</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logoTile(76)}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ display: "flex", color: "#ffffff", fontSize: 40, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1 }}>{pub}</span>
              <span style={{ display: "flex", color: accent, fontSize: 22, fontWeight: 600 }}>Club table · 24 members</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ROWS.map((r, i) => boardRow(r, i + 1, false))}
          </div>

          <span style={{ display: "flex", color: "#7a8478", fontSize: 21, fontWeight: 500, paddingTop: 2 }}>YourScore points — match wins + quiz knowledge, one table.</span>
        </div>
        <div style={{ position: "absolute", left: 0, bottom: 0, width: `${W.width}px`, height: 10, background: accent }} />
      </div>
    );
    return new ImageResponse(element, { ...W, emoji: "twemoji", headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  }

  // ── WIN (celebration) screen ────────────────────────────────────────────
  if (screen === "win") {
    const confetti = [
      { l: 90, t: 250, s: 22, c: accent }, { l: 700, t: 300, s: 18, c: "#ffd700" },
      { l: 160, t: 440, s: 14, c: "#ffd700" }, { l: 640, t: 470, s: 24, c: accent },
      { l: 70, t: 640, s: 16, c: "#ffffff" }, { l: 760, t: 700, s: 16, c: accent },
      { l: 120, t: 880, s: 20, c: "#ffd700" }, { l: 690, t: 920, s: 14, c: "#ffffff" },
      { l: 300, t: 250, s: 12, c: "#ffffff" }, { l: 520, t: 230, s: 16, c: "#ffd700" },
    ];
    const winInitials = winner.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "W";
    const element = (
      <div style={{ width: `${W.width}px`, height: `${W.height}px`, display: "flex", flexDirection: "column", alignItems: "center", background: "#0a0a0f", fontFamily: "sans-serif", position: "relative", padding: "60px 50px" }}>
        {Backdrop(true)}
        {confetti.map((d, i) => (
          <div key={i} style={{ position: "absolute", left: d.l, top: d.t, width: d.s, height: d.s, borderRadius: i % 2 ? 3 : 999, background: d.c, opacity: 0.85 }} />
        ))}

        <div style={{ display: "flex", width: "100%", justifyContent: "center", position: "relative" }}>{poweredBy}</div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "center", gap: 26, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 190, height: 190, borderRadius: 999, background: accentDim, border: `2px solid ${accentBorder}` }}>
            <span style={{ display: "flex", fontSize: 110 }}>🏆</span>
          </div>

          <span style={{ display: "flex", color: accent, fontSize: 86, fontWeight: 800, letterSpacing: 2 }}>YOU WON!</span>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ display: "flex", color: "#ffffff", fontSize: 38, fontWeight: 700, textAlign: "center" }}>{pub} quiz night</span>
            <span style={{ display: "flex", color: "#aeb6b0", fontSize: 26, fontWeight: 500 }}>1st place — Club League</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 34px", borderRadius: 20, background: "rgba(255,215,0,0.10)", border: "1px solid rgba(255,215,0,0.4)" }}>
            <span style={{ display: "flex", fontSize: 34 }}>🍺</span>
            <span style={{ display: "flex", color: "#ffd700", fontSize: 38, fontWeight: 800 }}>{prize}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 28px", borderRadius: 20, background: "rgba(18,20,24,0.85)", border: `1px solid ${accentBorder}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 999, background: ROWS[0].from }}>
              <span style={{ display: "flex", color: ROWS[0].fg, fontSize: 26, fontWeight: 700 }}>{winInitials}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ display: "flex", color: "#ffffff", fontSize: 32, fontWeight: 700 }}>{winner}</span>
              <span style={{ display: "flex", color: "#8a948f", fontSize: 22, fontWeight: 500 }}>14,820 YourScore points</span>
            </div>
          </div>
        </div>

        <span style={{ display: "flex", color: "#7a8a82", fontSize: 22, fontWeight: 500, position: "relative" }}>Win it at {pub} · on YourScore</span>
        <div style={{ position: "absolute", left: 0, bottom: 0, width: `${W.width}px`, height: 10, background: accent }} />
      </div>
    );
    return new ImageResponse(element, { ...W, emoji: "twemoji", headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  }

  // ── Default: landscape board card (inline-email hero) ───────────────────
  const element = (
    <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "#0a0a0f", fontFamily: "sans-serif", position: "relative", padding: "52px 60px" }}>
      {wallpaper ? (
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: "1200px", height: "630px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={wallpaper} width={1200} height={630} alt="" style={{ width: "1200px", height: "630px", objectFit: "cover", opacity: 0.28 }} />
          <div style={{ position: "absolute", top: 0, left: 0, width: "1200px", height: "630px", background: "linear-gradient(120deg, rgba(10,10,15,0.97) 30%, rgba(10,10,15,0.62) 100%)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, width: "1200px", height: "630px", background: accentDim }} />
        </div>
      ) : null}

      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_DATA_URI} width={205} height={55} alt="YourScore" style={{ display: "flex" }} />
        <div style={{ display: "flex", padding: "9px 22px", borderRadius: 999, background: accentDim, border: `1px solid ${accentBorder}` }}>
          <span style={{ display: "flex", color: accent, fontSize: 23, fontWeight: 800, letterSpacing: 3 }}>CLUB LEAGUE</span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: 48, paddingTop: 40, position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 470, gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logoTile(92)}
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

        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 9 }}>
          <span style={{ display: "flex", color: "#8a948f", fontSize: 18, fontWeight: 700, letterSpacing: 2, paddingBottom: 4 }}>CLUB TABLE</span>
          {ROWS.slice(0, 5).map((r, i) => {
            const top = i === 0;
            return (
              <div key={r.initials} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderRadius: 14, background: top ? accentDim : "rgba(14,16,20,0.82)", border: `1px solid ${top ? accentBorder : "rgba(255,255,255,0.07)"}` }}>
                <span style={{ display: "flex", width: 26, justifyContent: "center", color: top ? accent : "#8a948f", fontSize: 22, fontWeight: 800 }}>{i + 1}</span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 999, background: r.from }}>
                  <span style={{ display: "flex", color: r.fg, fontSize: 18, fontWeight: 700 }}>{r.initials}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 2 }}>
                  <span style={{ display: "flex", color: "#ffffff", fontSize: 23, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ display: "flex", color: "#7a8478", fontSize: 16, fontWeight: 500 }}>{r.record}</span>
                </div>
                <span style={{ display: "flex", color: top ? accent : "#cfcfe0", fontSize: 26, fontWeight: 800 }}>{r.pts}</span>
              </div>
            );
          })}
          <span style={{ display: "flex", color: "#566", fontSize: 15, fontWeight: 500, paddingTop: 4 }}>YourScore points — match wins + quiz knowledge, one table</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
    </div>
  );
  return new ImageResponse(element, { ...LANDSCAPE, emoji: "twemoji", headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
