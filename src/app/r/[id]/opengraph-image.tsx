/**
 * /r/[id] unfurl card (1200x630) — the per-team Scout verdict as it appears in
 * the feed. LEFT is the analysis chunk that earns the click and shows we did
 * the job: the real score, the verdict, and the strong/risk/one-move read,
 * under the YourScore mark. RIGHT is the same team as a live "Fantasy PL is
 * live" ad — their actual XI on the pitch with the grade badge and a league
 * chat pop. Reads off the stored snapshot; every node sets display:flex
 * (Satori requirement) or the PNG comes back empty.
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";
import { fetchRateShare } from "@/lib/fantasy/rateShare";
import type { RateSharePlayer } from "@/lib/fantasy/rateShareTypes";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Premier League fantasy team rated by the YourScore Scout";

const TEAL = "#2dd4bf";
const LIME = "#8ad14f";
const CORAL = "#ff7a85";
const GOLD = "#ffc400";
const INK = "#eef2f0";
const MUTED = "#8a948f";

const POS: Record<string, string> = { GK: GOLD, DEF: TEAL, MID: LIME, FWD: CORAL };
const ROW_ORDER = ["FWD", "MID", "DEF", "GK"] as const;

const bebasFont = fetch(new URL("./bebas.ttf", import.meta.url)).then((r) => r.arrayBuffer());
const dmSans500 = fetch(new URL("./dmsans-500.ttf", import.meta.url)).then((r) => r.arrayBuffer());
const dmSans700 = fetch(new URL("./dmsans-700.ttf", import.meta.url)).then((r) => r.arrayBuffer());

const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;
const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const scoreHue = (s: number) => (s >= 7 ? LIME : s >= 5 ? GOLD : CORAL);

function Pin({ name, pos, captain }: { name: string; pos: string; captain?: boolean }) {
  const c = POS[pos] ?? TEAL;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 60 }}>
      <div style={{ display: "flex", position: "relative", width: 32, height: 32, borderRadius: "50%", background: `${c}26`, border: `2px solid ${captain ? GOLD : c}`, alignItems: "center", justifyContent: "center" }}>
        <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 14, color: c }}>{name.slice(0, 1)}</span>
        {captain ? (
          <div style={{ display: "flex", position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%", background: GOLD, color: "#141007", fontSize: 9, fontWeight: 800, alignItems: "center", justifyContent: "center" }}>C</div>
        ) : null}
      </div>
      <div style={{ display: "flex", padding: "1px 6px", borderRadius: 5, background: "rgba(4,10,8,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ display: "flex", fontSize: 10.5, fontWeight: 700, color: INK }}>{clamp(surname(name), 10)}</span>
      </div>
    </div>
  );
}

/** One line of the read on the left — a colored tag then the fact. */
function ReadRow({ tag, tagColor, text }: { tag: string; tagColor: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11, background: "rgba(255,255,255,0.04)", border: `1px solid ${tagColor}44` }}>
      <div style={{ display: "flex", padding: "3px 8px", borderRadius: 6, background: `${tagColor}1e`, border: `1px solid ${tagColor}66` }}>
        <span style={{ display: "flex", fontSize: 11, fontWeight: 800, letterSpacing: 1, color: tagColor }}>{tag}</span>
      </div>
      <span style={{ display: "flex", flex: 1, fontSize: 16, fontWeight: 500, color: INK, lineHeight: 1.25 }}>{text}</span>
    </div>
  );
}

function Bubble({ text, mine }: { text: string; mine?: boolean }) {
  return (
    <div style={{ display: "flex", alignSelf: mine ? "flex-end" : "flex-start", maxWidth: 210, padding: "5px 10px", borderRadius: 11, fontSize: 12, fontWeight: 500, lineHeight: 1.3, background: mine ? `${TEAL}26` : "rgba(255,255,255,0.06)", border: `1px solid ${mine ? `${TEAL}55` : "rgba(255,255,255,0.09)"}`, color: mine ? "#d7fff8" : INK }}>
      {text}
    </div>
  );
}

function xiRows(players: RateSharePlayer[]) {
  const xi = players.filter((p) => !p.isBench);
  return ROW_ORDER.map((pos) => xi.filter((p) => p.pos === pos)).filter((r) => r.length > 0);
}

export default async function Image({ params }: { params: { id: string } }) {
  const [bebas, dm500, dm700] = await Promise.all([bebasFont, dmSans500, dmSans700]);
  const row = await fetchRateShare(params.id);
  const fonts = [
    { name: "Bebas", data: bebas, style: "normal" as const, weight: 400 as const },
    { name: "DM Sans", data: dm500, style: "normal" as const, weight: 500 as const },
    { name: "DM Sans", data: dm700, style: "normal" as const, weight: 700 as const },
  ];

  // Missing snapshot → a clean branded fallback rather than an empty card.
  if (!row) {
    return new ImageResponse(
      (
        <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 80px", background: "linear-gradient(150deg, #0a0a0f 0%, #08130f 55%, #06110d 100%)", fontFamily: "DM Sans" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={240} height={64} alt="YourScore" style={{ display: "flex" }} />
          <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 76, color: TEAL, marginTop: 26 }}>RATE YOUR FPL TEAM</span>
          <span style={{ display: "flex", fontSize: 24, color: "#c4ccc6", marginTop: 10 }}>The YourScore Scout scores it out of 10 in seconds.</span>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const m = row.rating.month;
  const strong = m.bands.strong[0]?.name;
  const risk = (m.bands.weak[0] ?? m.bands.decent[m.bands.decent.length - 1])?.name;
  const rows = xiRows(row.players);

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", position: "relative", background: "linear-gradient(150deg, #0a0a0f 0%, #08130f 55%, #06110d 100%)", fontFamily: "DM Sans", overflow: "hidden" }}>
        <div style={{ display: "flex", position: "absolute", right: -120, top: -180, width: 760, height: 760, borderRadius: "50%", background: "radial-gradient(circle, rgba(45,212,191,0.12) 0%, rgba(45,212,191,0.03) 45%, rgba(0,0,0,0) 70%)" }} />

        {/* left — the analysis chunk */}
        <div style={{ display: "flex", flexDirection: "column", width: 560, padding: "46px 0 0 60px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={176} height={47} alt="YourScore" style={{ display: "flex" }} />
            <div style={{ display: "flex", padding: "5px 11px", borderRadius: 999, background: `${TEAL}1c`, border: `1px solid ${TEAL}66` }}>
              <span style={{ display: "flex", color: TEAL, fontSize: 12, fontWeight: 800, letterSpacing: 1.2 }}>SCOUT</span>
            </div>
          </div>

          <span style={{ display: "flex", color: MUTED, fontSize: 15, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>THIS TEAM, THIS MONTH</span>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 116, lineHeight: 0.82, color: scoreHue(m.score) }}>{m.score.toFixed(1)}</span>
            <span style={{ display: "flex", color: MUTED, fontSize: 22, fontWeight: 600, paddingBottom: 14 }}>out of 10</span>
          </div>
          <span style={{ display: "flex", color: INK, fontSize: 20, fontWeight: 500, lineHeight: 1.34, maxWidth: 476, marginBottom: 18 }}>
            {clamp(m.verdict, 190)}
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 476 }}>
            {strong ? <ReadRow tag="STRONG" tagColor={LIME} text={clamp(strong, 30)} /> : null}
            {risk ? <ReadRow tag="RISK" tagColor={CORAL} text={clamp(risk, 30)} /> : null}
            <ReadRow tag="MOVE" tagColor={TEAL} text={clamp(m.moveLine, 92)} />
          </div>
        </div>

        {/* right — the same team as a live Fantasy PL ad */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 640, top: 40, width: 512, borderRadius: 22, padding: "15px 16px 16px", background: "linear-gradient(180deg, #0e1a14 0%, #0a130f 100%)", border: `1px solid ${TEAL}44`, boxShadow: "0 26px 70px rgba(0,0,0,0.6)", transform: "rotate(2deg)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 20, letterSpacing: 1.5, color: INK }}>FANTASY PL IS LIVE</span>
            <div style={{ display: "flex", padding: "3px 9px", borderRadius: 6, background: `${GOLD}1f`, border: `1px solid ${GOLD}66`, color: GOLD, fontSize: 9.5, fontWeight: 800, letterSpacing: 1 }}>MONTHLY PRIZES</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", marginTop: 8, height: 328, borderRadius: 14, padding: "16px 8px 40px", background: "linear-gradient(180deg, rgba(30,90,58,0.30) 0%, rgba(14,40,26,0.30) 100%)", border: "1px solid rgba(46,138,90,0.35)" }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                {r.map((p) => <Pin key={p.id} name={p.name} pos={p.pos} captain={p.isCaptain} />)}
              </div>
            ))}
          </div>
        </div>

        {/* the grade badge over the ad */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 902, top: 404, width: 244, borderRadius: 16, padding: "12px 15px", background: "linear-gradient(180deg, #0d1917 0%, #0a1311 100%)", border: `1px solid ${TEAL}77`, boxShadow: "0 24px 60px rgba(0,0,0,0.65)", transform: "rotate(4deg)" }}>
          <span style={{ display: "flex", color: TEAL, fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>THE SCOUT · THIS MONTH</span>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 56, lineHeight: 0.9, color: scoreHue(m.score) }}>{m.score.toFixed(1)}</span>
            <span style={{ display: "flex", color: MUTED, fontSize: 14, fontWeight: 600, paddingBottom: 8 }}>/ 10</span>
          </div>
          {strong ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "5px 9px", borderRadius: 8, background: `${LIME}1e`, border: `1px solid ${LIME}55` }}>
              <span style={{ display: "flex", fontSize: 9.5, fontWeight: 800, color: LIME }}>STRONG</span>
              <span style={{ display: "flex", fontSize: 12.5, fontWeight: 700, color: INK }}>{clamp(surname(strong), 12)}</span>
            </div>
          ) : null}
        </div>

        {/* league chat pop — the social hook */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 600, top: 392, width: 272, borderRadius: 18, padding: "12px 14px", background: "linear-gradient(180deg, #101b16 0%, #0b1310 100%)", border: `1px solid ${LIME}55`, boxShadow: "0 24px 60px rgba(0,0,0,0.65)", transform: "rotate(-5deg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ display: "flex", width: 21, height: 21, borderRadius: 7, background: `${LIME}22`, border: `1px solid ${LIME}66`, alignItems: "center", justifyContent: "center", color: LIME, fontSize: 12, fontWeight: 800 }}>#</div>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 16, letterSpacing: 1, color: INK }}>THE OFFICE LEAGUE</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Bubble text="Scout says your back line is weak lol" />
            <Bubble text="Rated mine 8.1, get on my level" mine />
          </div>
        </div>

        <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: TEAL }} />
      </div>
    ),
    { ...size, fonts },
  );
}
