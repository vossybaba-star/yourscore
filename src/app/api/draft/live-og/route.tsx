/**
 * /api/draft/live-og — share card (1200x630) for a 38-0 LIVE two-half result.
 * Broadcast-style scoreline graphic with Player of the Match + key stats, so a
 * shared result posts as an image / unfurls as a rich card on X & socials.
 *
 * Neutral framing (just the scoreline) so EITHER manager can share the same card.
 * Driven by query params (kept on the edge, cacheable):
 *   p1,p2  names · s1,s2 goals · str1,str2 strength · pens "5-4"
 *   potm name · potmR rating · sc scorers "Salah 2 · Henry" · cor "9-3" · thr "26-12"
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const GREEN = "#00ff87";
const AMBER = "#ffb800";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const p1 = (q.get("p1") ?? "Home").slice(0, 24);
  const p2 = (q.get("p2") ?? "Away").slice(0, 24);
  const s1 = q.get("s1") ?? "0";
  const s2 = q.get("s2") ?? "0";
  const str1 = q.get("str1");
  const str2 = q.get("str2");
  const pens = q.get("pens"); // "5-4" if a shootout decided it
  const potm = q.get("potm");
  const potmR = q.get("potmR");
  const sc = q.get("sc");
  const cor = q.get("cor");
  const thr = q.get("thr");

  // Decide the winner (penalties override the aggregate) for score colouring.
  const [pa, pb] = pens ? pens.split("-").map((n) => parseInt(n, 10)) : [NaN, NaN];
  const n1 = Number(s1), n2 = Number(s2);
  const aWon = pens ? pa > pb : n1 > n2;
  const bWon = pens ? pb > pa : n2 > n1;
  const c1 = aWon ? GREEN : bWon ? "#cfcfe6" : AMBER;
  const c2 = bWon ? GREEN : aWon ? "#cfcfe6" : AMBER;

  const stat = (label: string, value: string, color = "#fff") => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 40, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 22, color: "#8888aa", letterSpacing: 1, marginTop: 4 }}>{label}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #12121e 100%)", padding: "56px 64px", fontFamily: "sans-serif", position: "relative" }}>
        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ color: "#fff" }}>YOUR</span>
            <span style={{ color: GREEN }}>SCORE</span>
            <span style={{ color: "#8888aa", marginLeft: 14, fontWeight: 600 }}>· 38-0 LIVE</span>
          </div>
          <div style={{ fontSize: 26, color: AMBER, fontWeight: 700, letterSpacing: 2 }}>FULL TIME</div>
        </div>

        {/* scoreline */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 54 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 380 }}>
            <div style={{ fontSize: 46, fontWeight: 800, color: c1, textAlign: "right", lineHeight: 1.05 }}>{p1}</div>
            {str1 ? <div style={{ fontSize: 24, color: "#8888aa", marginTop: 6 }}>{`STR ${str1}`}</div> : <div />}
          </div>
          <div style={{ display: "flex", alignItems: "center", margin: "0 36px" }}>
            <span style={{ fontSize: 120, fontWeight: 900, color: c1 }}>{s1}</span>
            <span style={{ fontSize: 70, fontWeight: 700, color: "#555", margin: "0 18px" }}>–</span>
            <span style={{ fontSize: 120, fontWeight: 900, color: c2 }}>{s2}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: 380 }}>
            <div style={{ fontSize: 46, fontWeight: 800, color: c2, lineHeight: 1.05 }}>{p2}</div>
            {str2 ? <div style={{ fontSize: 24, color: "#8888aa", marginTop: 6 }}>{`STR ${str2}`}</div> : <div />}
          </div>
        </div>

        {pens ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14, fontSize: 28, color: AMBER }}>{`Penalties ${pens}`}</div>
        ) : <div />}

        {potm ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(255,184,0,0.12)", border: "2px solid rgba(255,184,0,0.4)", borderRadius: 18, padding: "12px 26px" }}>
              <span style={{ fontSize: 26, color: AMBER, marginRight: 12 }}>⭐ MOTM</span>
              <span style={{ fontSize: 30, color: "#fff", fontWeight: 700 }}>{potm}</span>
              {potmR ? <span style={{ fontSize: 30, color: AMBER, fontWeight: 800, marginLeft: 12 }}>{potmR}</span> : <span />}
            </div>
          </div>
        ) : <div />}

        {/* stat strip + scorers */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
            {cor ? stat("CORNERS", cor) : <div />}
            {thr ? stat("THROW-INS", thr) : <div />}
          </div>
          <div style={{ display: "flex", maxWidth: 540, fontSize: 24, color: "#cfcfe6", textAlign: "right", justifyContent: "flex-end" }}>
            {sc ? `⚽ ${sc}` : ""}
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 26 }}>
          <div style={{ fontSize: 26, color: "#cfcfe6" }}>Build your all-time XI. Go live, head-to-head.</div>
          <div style={{ fontSize: 28, color: GREEN, fontWeight: 700 }}>yourscore.app/38-0</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: GREEN }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
