/**
 * /api/og/home — the site's social link-preview image (1200x630).
 *
 * The branded unfurl for yourscore.app. Sells the whole platform, not one game:
 * "The Home of Football Gaming" headline plus a fanned trio of game cards
 * (38-0 green / Perfect 10 gold / Quiz teal) mocked in the app's real design
 * language. Referenced from the root metadata (layout + homepage).
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GREEN = "#aeea00";
const GOLD = "#ffc400";
const TEAL = "#2dd4bf";

const bebasFont = fetch(new URL("./bebas.ttf", import.meta.url)).then((res) =>
  res.arrayBuffer()
);
const dmSans500 = fetch(new URL("./dmsans-500.ttf", import.meta.url)).then((res) => res.arrayBuffer());
const dmSans700 = fetch(new URL("./dmsans-700.ttf", import.meta.url)).then((res) => res.arrayBuffer());

function Dot() {
  return (
    <div
      style={{
        display: "flex",
        width: 15,
        height: 15,
        borderRadius: "50%",
        background: "rgba(174,234,0,0.30)",
        border: "1px solid rgba(174,234,0,0.55)",
      }}
    />
  );
}

function Tiles({ n }: { n: number }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: "flex", width: 14, height: 20, borderRadius: 3, background: "rgba(255,255,255,0.07)" }} />
      ))}
    </div>
  );
}

function SolvedRung({ rank, name }: { rank: number; name: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 31, borderRadius: 9, padding: "0 10px", background: "#241f0e", border: "1px solid rgba(255,196,0,0.28)" }}>
      <div style={{ display: "flex", width: 19, height: 19, borderRadius: "50%", alignItems: "center", justifyContent: "center", background: "rgba(255,196,0,0.16)", color: GOLD, fontFamily: "Bebas", fontSize: 12 }}>{rank}</div>
      <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 17, letterSpacing: 1.2, color: "#ffe082" }}>{name}</span>
      <div style={{ display: "flex", marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "rgba(174,234,0,0.14)", color: GREEN }}>+10</div>
    </div>
  );
}

function BlankRung({ rank, tiles }: { rank: number; tiles: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 31, borderRadius: 9, padding: "0 10px", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ display: "flex", width: 19, height: 19, borderRadius: "50%", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.06)", color: "#586058", fontFamily: "Bebas", fontSize: 12 }}>{rank}</div>
      <Tiles n={tiles} />
    </div>
  );
}

export async function GET() {
  const [bebas, dm500, dm700] = await Promise.all([bebasFont, dmSans500, dmSans700]);
  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", position: "relative", background: "linear-gradient(150deg, #0a0a0f 0%, #0b1a12 55%, #08130d 100%)", fontFamily: "DM Sans", overflow: "hidden" }}>
        {/* ambient glow */}
        <div style={{ display: "flex", position: "absolute", right: -100, top: -160, width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(174,234,0,0.07) 0%, rgba(174,234,0,0.02) 45%, rgba(0,0,0,0) 70%)" }} />

        {/* left column */}
        <div style={{ display: "flex", flexDirection: "column", width: 560, padding: "70px 0 0 72px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={280} height={75} alt="YourScore" style={{ display: "flex" }} />
          <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 74, lineHeight: 1, color: "#fff", letterSpacing: 1, marginTop: 34 }}>THE HOME OF</span>
          <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 74, lineHeight: 1, color: GREEN, letterSpacing: 1 }}>FOOTBALL GAMING</span>
          <span style={{ display: "flex", marginTop: 20, color: "#c4ccc6", fontSize: 23, fontWeight: 500, lineHeight: 1.5, maxWidth: 420 }}>
            Daily football quizzes, head-to-head battles and private leagues with your friends.
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 36 }}>
            <div style={{ display: "flex", padding: "13px 30px", borderRadius: 999, background: GREEN, color: "#0a0a0f", fontSize: 21, fontWeight: 700, letterSpacing: 2.5 }}>PLAY FREE</div>
            <span style={{ display: "flex", color: GREEN, fontSize: 21, fontWeight: 700 }}>yourscore.app</span>
          </div>
        </div>

        {/* 38-0 card (green) */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 600, top: 52, width: 322, borderRadius: 20, padding: "20px 22px", background: "linear-gradient(180deg, #101a10 0%, #0b120b 100%)", border: "1px solid rgba(174,234,0,0.30)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)", transform: "rotate(-4deg)" }}>
          <span style={{ display: "flex", color: GREEN, fontSize: 12, fontWeight: 700, letterSpacing: 2.5 }}>38-0 · HEAD-TO-HEAD</span>
          <div style={{ display: "flex", marginTop: 6 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 88, lineHeight: 1, color: "#fff" }}>38</span>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 88, lineHeight: 1, color: "#9aa39d" }}>-</span>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 88, lineHeight: 1, color: GREEN }}>0</span>
          </div>
          <span style={{ display: "flex", marginTop: 4, color: "#c4ccc6", fontSize: 12.5, fontWeight: 600 }}>Build your all-time XI. Go unbeaten.</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}><Dot /><Dot /><Dot /></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}><Dot /><Dot /><Dot /><Dot /></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}><Dot /><Dot /><Dot /></div>
          </div>
        </div>

        {/* Perfect 10 card (gold) */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 836, top: 180, width: 330, borderRadius: 20, padding: "20px 22px", background: "linear-gradient(180deg, #17140b 0%, #100e08 100%)", border: "1px solid rgba(255,196,0,0.30)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)", transform: "rotate(4deg)" }}>
          <span style={{ display: "flex", color: GOLD, fontSize: 12, fontWeight: 700, letterSpacing: 2.5 }}>PERFECT 10 · RANKED LIST</span>
          <span style={{ display: "flex", fontFamily: "Bebas", color: GOLD, fontSize: 22, letterSpacing: 0.6, marginTop: 7, lineHeight: 1.08 }}>Premier League&apos;s All-Time Top 10 Goalscorers</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 11 }}>
            <SolvedRung rank={1} name="SHEARER" />
            <SolvedRung rank={2} name="KANE" />
            <BlankRung rank={3} tiles={6} />
            <BlankRung rank={4} tiles={4} />
          </div>
        </div>

        {/* Quiz card (teal) */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 570, top: 388, width: 300, borderRadius: 20, padding: "20px 22px", background: "linear-gradient(180deg, #0c1517 0%, #0a1012 100%)", border: "1px solid rgba(45,212,191,0.35)", boxShadow: "0 24px 60px rgba(0,0,0,0.55)", transform: "rotate(2.5deg)" }}>
          <span style={{ display: "flex", color: TEAL, fontSize: 12, fontWeight: 700, letterSpacing: 2.5 }}>FOOTBALL QUIZ · VERSUS</span>
          <span style={{ display: "flex", fontFamily: "Bebas", color: "#fff", fontSize: 23, letterSpacing: 0.6, marginTop: 8, lineHeight: 1.1 }}>Which club has won the most Premier League titles?</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", borderRadius: 9, background: "rgba(45,212,191,0.13)", border: "1px solid rgba(45,212,191,0.45)", color: TEAL, fontSize: 14, fontWeight: 600 }}>
              <div style={{ display: "flex", width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", background: "rgba(45,212,191,0.25)", fontFamily: "Bebas", fontSize: 13, color: TEAL }}>A</div>
              Manchester United
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", borderRadius: 9, background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.07)", color: "#c4ccc6", fontSize: 14, fontWeight: 600 }}>
              <div style={{ display: "flex", width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.07)", fontFamily: "Bebas", fontSize: 13, color: "#9aa39d" }}>B</div>
              Manchester City
            </div>
          </div>
        </div>

        <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: GREEN }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Bebas", data: bebas, style: "normal", weight: 400 },
        { name: "DM Sans", data: dm500, style: "normal", weight: 500 },
        { name: "DM Sans", data: dm700, style: "normal", weight: 700 },
      ],
    }
  );
}
