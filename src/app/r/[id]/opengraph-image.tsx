/**
 * /r/[id] unfurl card (1200x630) — the per-team "Scout's Report" as it appears
 * in the feed, built to POP. LEFT is the headline + the analysis chunk that
 * earns the click and shows we did the job: a big SCOUT'S REPORT, the real
 * score, the verdict, and the strong/risk/one-move read, under the YourScore
 * mark. RIGHT is the analysed squad itself — their XI (and bench) on a pitch
 * with the grade. Reads off the stored snapshot; every node sets display:flex
 * (Satori requirement) or the PNG comes back empty.
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";
import { fetchRateShare } from "@/lib/fantasy/rateShare";
import { faceUrlById } from "@/lib/fantasy/faces";
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
const clamp = (s: string, n: number) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};
const scoreHue = (s: number) => (s >= 7 ? LIME : s >= 5 ? GOLD : CORAL);

function Pin({ id, name, pos, captain }: { id: number; name: string; pos: string; captain?: boolean }) {
  const c = POS[pos] ?? TEAL;
  const face = faceUrlById(id);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 60 }}>
      <div style={{ display: "flex", position: "relative", width: 42, height: 42 }}>
        <div style={{ display: "flex", width: 42, height: 42, borderRadius: "50%", overflow: "hidden", background: `${c}2b`, border: `2px solid ${captain ? GOLD : c}`, alignItems: "center", justifyContent: "center" }}>
          {face ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={face} width={42} height={42} alt="" style={{ display: "flex", width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} />
          ) : (
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 17, color: c }}>{name.slice(0, 1)}</span>
          )}
        </div>
        {captain ? (
          <div style={{ display: "flex", position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: GOLD, color: "#141007", fontSize: 9.5, fontWeight: 800, alignItems: "center", justifyContent: "center" }}>C</div>
        ) : null}
      </div>
      <div style={{ display: "flex", padding: "1px 6px", borderRadius: 5, background: "rgba(4,10,8,0.78)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <span style={{ display: "flex", fontSize: 10.5, fontWeight: 700, color: INK }}>{clamp(surname(name), 9)}</span>
      </div>
    </div>
  );
}

function BenchChip({ p }: { p: RateSharePlayer }) {
  const c = POS[p.pos] ?? TEAL;
  const face = faceUrlById(p.id);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 3px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
      <div style={{ display: "flex", width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: `${c}22`, border: `1px solid ${c}`, alignItems: "center", justifyContent: "center" }}>
        {face ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={face} width={22} height={22} alt="" style={{ display: "flex", width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <span style={{ display: "flex", fontSize: 10, fontWeight: 800, color: c }}>{p.name.slice(0, 1)}</span>
        )}
      </div>
      <span style={{ display: "flex", fontSize: 11.5, fontWeight: 700, color: INK }}>{clamp(surname(p.name), 10)}</span>
    </div>
  );
}

/** One line of the read on the left — a colored tag then the fact. */
function ReadRow({ tag, tagColor, text }: { tag: string; tagColor: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", borderRadius: 12, background: "rgba(255,255,255,0.045)", border: `1px solid ${tagColor}4d` }}>
      <div style={{ display: "flex", padding: "4px 9px", borderRadius: 6, background: `${tagColor}24`, border: `1px solid ${tagColor}77` }}>
        <span style={{ display: "flex", fontSize: 11.5, fontWeight: 800, letterSpacing: 1, color: tagColor }}>{tag}</span>
      </div>
      <span style={{ display: "flex", flex: 1, fontSize: 16.5, fontWeight: 600, color: INK, lineHeight: 1.25 }}>{text}</span>
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
  const bench = row.players.filter((p) => p.isBench);
  const hue = scoreHue(m.score);

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", position: "relative", background: "linear-gradient(145deg, #0b0b11 0%, #08140f 52%, #050f0c 100%)", fontFamily: "DM Sans", overflow: "hidden" }}>
        {/* glows for pop */}
        <div style={{ display: "flex", position: "absolute", left: -160, top: -200, width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(45,212,191,0.16) 0%, rgba(45,212,191,0.04) 45%, rgba(0,0,0,0) 70%)" }} />
        <div style={{ display: "flex", position: "absolute", right: -120, bottom: -220, width: 640, height: 640, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,196,0,0.10) 0%, rgba(255,196,0,0.03) 45%, rgba(0,0,0,0) 70%)" }} />

        {/* left — the report */}
        <div style={{ display: "flex", flexDirection: "column", width: 636, padding: "42px 0 0 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={158} height={42} alt="YourScore" style={{ display: "flex" }} />
            <div style={{ display: "flex", padding: "5px 11px", borderRadius: 999, background: `${TEAL}1f`, border: `1px solid ${TEAL}77` }}>
              <span style={{ display: "flex", color: TEAL, fontSize: 12, fontWeight: 800, letterSpacing: 1.4 }}>SCOUT</span>
            </div>
          </div>

          {/* the headline */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 92, lineHeight: 0.9, color: "#ffffff", letterSpacing: 1 }}>SCOUT&apos;S</span>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 92, lineHeight: 0.9, color: TEAL, letterSpacing: 1 }}>REPORT</span>
          </div>
          <div style={{ display: "flex", width: 132, height: 6, borderRadius: 3, background: TEAL, marginTop: 12, marginBottom: 22 }} />

          {/* the score */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 16 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 118, lineHeight: 0.78, color: hue }}>{m.score.toFixed(1)}</span>
            <div style={{ display: "flex", flexDirection: "column", paddingBottom: 12 }}>
              <span style={{ display: "flex", color: MUTED, fontSize: 15, fontWeight: 800, letterSpacing: 2 }}>THIS MONTH</span>
              <span style={{ display: "flex", color: MUTED, fontSize: 19, fontWeight: 600 }}>out of 10</span>
            </div>
          </div>

          {/* the verdict */}
          <span style={{ display: "flex", color: INK, fontSize: 19, fontWeight: 500, lineHeight: 1.34, maxWidth: 544, marginBottom: 18 }}>
            {clamp(m.verdict, 150)}
          </span>

          {/* the read */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, width: 544 }}>
            {strong ? <ReadRow tag="STRONG" tagColor={LIME} text={clamp(strong, 30)} /> : null}
            {risk ? <ReadRow tag="RISK" tagColor={CORAL} text={clamp(risk, 30)} /> : null}
            <ReadRow tag="MOVE" tagColor={TEAL} text={clamp(m.moveLine, 92)} />
          </div>
        </div>

        {/* right — the analysed squad */}
        <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 664, top: 40, width: 480, borderRadius: 22, padding: "16px 18px 16px", background: "linear-gradient(180deg, #0f1c15 0%, #0a130f 100%)", border: `1px solid ${TEAL}55`, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 26, letterSpacing: 2, color: INK }}>THE ANALYSED SQUAD</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, padding: "4px 11px", borderRadius: 9, background: `${hue}1f`, border: `1px solid ${hue}77` }}>
              <span style={{ display: "flex", fontFamily: "Bebas", fontSize: 24, lineHeight: 1, color: hue }}>{m.score.toFixed(1)}</span>
              <span style={{ display: "flex", color: MUTED, fontSize: 12, fontWeight: 700, paddingBottom: 2 }}>/10</span>
            </div>
          </div>

          {/* pitch */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: 320, borderRadius: 14, padding: "18px 8px 18px", background: "linear-gradient(180deg, rgba(34,102,64,0.34) 0%, rgba(14,42,27,0.34) 100%)", border: "1px solid rgba(46,138,90,0.4)" }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                {r.map((p) => <Pin key={p.id} id={p.id} name={p.name} pos={p.pos} captain={p.isCaptain} />)}
              </div>
            ))}
          </div>

          {/* bench */}
          {bench.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
              <span style={{ display: "flex", fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, color: MUTED }}>BENCH</span>
              <div style={{ display: "flex", gap: 7 }}>
                {bench.map((p) => <BenchChip key={p.id} p={p} />)}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <div style={{ display: "flex", width: 8, height: 8, borderRadius: 4, background: GOLD }} />
            <span style={{ display: "flex", color: GOLD, fontSize: 12.5, fontWeight: 800, letterSpacing: 1 }}>FANTASY PL IS LIVE ON YOURSCORE</span>
          </div>
        </div>

        <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: "1200px", height: 14, background: `linear-gradient(90deg, ${TEAL} 0%, ${LIME} 100%)` }} />
      </div>
    ),
    { ...size, fonts },
  );
}
