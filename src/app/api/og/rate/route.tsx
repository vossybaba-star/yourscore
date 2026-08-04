/**
 * /api/og/rate — social link-preview image (1200x630) for /fantasy/rate.
 *
 * A launch ad for YourScore Fantasy PL. Left: the "now live" heading + the
 * message (upload a screenshot, the Scout grades it). Right: a collage that
 * shows the product off — a full XI on the pitch with the Scout's grade, plus a
 * league-chat card popping out to sell the social side. Teal is the Scout's
 * colour. Every node sets display:flex (Satori requirement) — a bare block
 * yields a 0-byte PNG.
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const TEAL = "#2dd4bf";
const LIME = "#8ad14f";
const CORAL = "#ff7a85";
const GOLD = "#ffc400";
const INK = "#eef2f0";

const POS: Record<string, string> = { GK: GOLD, DEF: TEAL, MID: LIME, FWD: CORAL };

const bebasFont = fetch(new URL("./bebas.ttf", import.meta.url)).then((r) => r.arrayBuffer());
const dmSans500 = fetch(new URL("./dmsans-500.ttf", import.meta.url)).then((r) => r.arrayBuffer());
const dmSans700 = fetch(new URL("./dmsans-700.ttf", import.meta.url)).then((r) => r.arrayBuffer());

function Pin({ name, pos, captain }: { name: string; pos: keyof typeof POS; captain?: boolean }) {
  const c = POS[pos];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 66 }}>
      <div style={{ display: "flex", position: "relative", width: 34, height: 34, borderRadius: "50%", background: `${c}26`, border: `2px solid ${captain ? GOLD : c}`, alignItems: "center", justifyContent: "center" }}>
        <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 15, color: c }}>{name.slice(0, 1)}</span>
        {captain ? (
          <div style={{ display: "flex", position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: GOLD, color: "#141007", fontSize: 10, fontWeight: 800, alignItems: "center", justifyContent: "center" }}>C</div>
        ) : null}
      </div>
      <div style={{ display: "flex", padding: "1px 7px", borderRadius: 5, background: "rgba(4,10,8,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ display: "flex", fontSize: 11, fontWeight: 700, color: INK }}>{name}</span>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>{children}</div>;
}

function Bubble({ text, mine }: { text: string; mine?: boolean }) {
  return (
    <div style={{ display: "flex", alignSelf: mine ? "flex-end" : "flex-start", maxWidth: 210, padding: "6px 11px", borderRadius: 12, fontSize: 12.5, fontWeight: 500, lineHeight: 1.3,
      background: mine ? `${TEAL}26` : "rgba(255,255,255,0.06)", border: `1px solid ${mine ? `${TEAL}55` : "rgba(255,255,255,0.09)"}`, color: mine ? "#d7fff8" : INK }}>
      {text}
    </div>
  );
}

export async function GET() {
  const [bebas, dm500, dm700] = await Promise.all([bebasFont, dmSans500, dmSans700]);
  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", position: "relative", background: "linear-gradient(150deg, #0a0a0f 0%, #08130f 55%, #06110d 100%)", fontFamily: "DM Sans", overflow: "hidden" }}>
        <div style={{ display: "flex", position: "absolute", right: -120, top: -180, width: 760, height: 760, borderRadius: "50%", background: "radial-gradient(circle, rgba(45,212,191,0.12) 0%, rgba(45,212,191,0.03) 45%, rgba(0,0,0,0) 70%)" }} />

        {/* left column — the message */}
        <div style={{ display: "flex", flexDirection: "column", width: 486, padding: "52px 0 0 64px" }}>
          <div style={{ display: "flex", alignSelf: "flex-start", padding: "6px 14px", borderRadius: 999, background: `${GOLD}1c`, border: `1px solid ${GOLD}66`, marginBottom: 20 }}>
            <span style={{ display: "flex", color: GOLD, fontSize: 14, fontWeight: 800, letterSpacing: 1.5 }}>FANTASY PL IS LIVE ON YOURSCORE</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={228} height={61} alt="YourScore" style={{ display: "flex" }} />
          <div style={{ display: "flex", marginTop: 26 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 72, lineHeight: 0.96, color: "#fff", letterSpacing: 1 }}>RATE YOUR</span>
          </div>
          <div style={{ display: "flex" }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 72, lineHeight: 0.96, color: TEAL, letterSpacing: 1 }}>FPL TEAM</span>
          </div>
          <span style={{ display: "flex", marginTop: 18, color: "#c4ccc6", fontSize: 23, fontWeight: 500, lineHeight: 1.4, maxWidth: 400 }}>
            Upload one screenshot. The YourScore Scout scores it in seconds.
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 26 }}>
            <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: TEAL, color: "#03211d", fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>FREE</div>
            <span style={{ display: "flex", color: TEAL, fontSize: 19, fontWeight: 700 }}>yourscore.app</span>
          </div>
        </div>

        {/* right — the ad: squad + Scout grade */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 566, top: 34, width: 566, borderRadius: 24, padding: "16px 18px 18px", background: "linear-gradient(180deg, #0e1a14 0%, #0a130f 100%)", border: `1px solid ${TEAL}44`, boxShadow: "0 26px 70px rgba(0,0,0,0.6)", transform: "rotate(2deg)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 22, letterSpacing: 2, color: INK }}>YOURSCORE FANTASY PL</span>
            <div style={{ display: "flex", padding: "3px 9px", borderRadius: 6, background: `${GOLD}1f`, border: `1px solid ${GOLD}66`, color: GOLD, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>MONTHLY PRIZES</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", marginTop: 10, height: 316, borderRadius: 14, padding: "16px 8px 46px", background: "linear-gradient(180deg, rgba(30,90,58,0.30) 0%, rgba(14,40,26,0.30) 100%)", border: "1px solid rgba(46,138,90,0.35)" }}>
            <Row><Pin name="Haaland" pos="FWD" captain /><Pin name="Isak" pos="FWD" /></Row>
            <Row><Pin name="Saka" pos="MID" /><Pin name="Palmer" pos="MID" /><Pin name="Odegaard" pos="MID" /><Pin name="Semenyo" pos="MID" /></Row>
            <Row><Pin name="Gabriel" pos="DEF" /><Pin name="Gvardiol" pos="DEF" /><Pin name="Saliba" pos="DEF" /><Pin name="Hall" pos="DEF" /></Row>
            <Row><Pin name="Raya" pos="GK" /></Row>
          </div>
        </div>

        {/* the Scout grade — a badge over the ad's lower-right */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 902, top: 402, width: 244, borderRadius: 16, padding: "12px 15px", background: "linear-gradient(180deg, #0d1917 0%, #0a1311 100%)", border: `1px solid ${TEAL}77`, boxShadow: "0 24px 60px rgba(0,0,0,0.65)", transform: "rotate(4deg)" }}>
          <span style={{ display: "flex", color: TEAL, fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>THE SCOUT · THIS MONTH</span>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 56, lineHeight: 0.9, color: GOLD }}>7.4</span>
            <span style={{ display: "flex", color: "#8a948f", fontSize: 14, fontWeight: 600, paddingBottom: 8 }}>/ 10</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "5px 9px", borderRadius: 8, background: `${LIME}1e`, border: `1px solid ${LIME}55` }}>
            <span style={{ display: "flex", fontSize: 9.5, fontWeight: 800, color: LIME }}>STRONG</span>
            <span style={{ display: "flex", fontSize: 12.5, fontWeight: 700, color: INK }}>Haaland</span>
          </div>
        </div>

        {/* league chat — a pop-out over the ad's lower-left, the social hook */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 528, top: 388, width: 284, borderRadius: 18, padding: "13px 15px", background: "linear-gradient(180deg, #101b16 0%, #0b1310 100%)", border: `1px solid ${LIME}55`, boxShadow: "0 24px 60px rgba(0,0,0,0.65)", transform: "rotate(-5deg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <div style={{ display: "flex", width: 22, height: 22, borderRadius: 7, background: `${LIME}22`, border: `1px solid ${LIME}66`, alignItems: "center", justifyContent: "center", color: LIME, fontSize: 12, fontWeight: 800 }}>#</div>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 17, letterSpacing: 1, color: INK }}>THE OFFICE LEAGUE</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Bubble text="Bruno is a lock this week" />
            <Bubble text="Saka is my captain, no debate" mine />
            <Bubble text="Scout says my back line is weak lol" />
          </div>
        </div>

        <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: TEAL }} />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      // Static share card — cache hard at the edge so crawler bursts don't
      // re-render the Satori image each hit (Vercel CPU usage, 4 Aug).
      headers: { "cache-control": "public, no-transform, max-age=600, s-maxage=3600, stale-while-revalidate=86400" },
      fonts: [
        { name: "Bebas", data: bebas, style: "normal", weight: 400 },
        { name: "DM Sans", data: dm500, style: "normal", weight: 500 },
        { name: "DM Sans", data: dm700, style: "normal", weight: 700 },
      ],
    }
  );
}
