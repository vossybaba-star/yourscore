/**
 * /api/draft/live-og — share card (1200x630) for a 38-0 LIVE two-half result.
 * Broadcast-style scoreline + a full head-to-head stat panel + Player of the
 * Match, so a shared result posts as an image / unfurls as a rich card on socials.
 *
 * Neutral framing (just the scoreline) so EITHER manager can share the same card.
 * Driven by query params (kept on the edge, cacheable):
 *   p1,p2 names · s1,s2 goals · str1,str2 strength · pens "5-4"
 *   potm name · potmR rating · sc scorers "Salah 2 · Henry"
 *   pos "55-45" · sh shots · sot on-target · cor corners · fo fouls · off offsides · thr throw-ins
 *
 * Satori note: every element with >1 child MUST set display:flex, and text must
 * be a single child (use template strings, not "LABEL {value}").
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const GREEN = "#aeea00";
const AMBER = "#ffb800";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const g = (k: string) => q.get(k);
  const portrait = g("portrait") === "1";
  const p1 = (g("p1") ?? "Home").slice(0, 22);
  const p2 = (g("p2") ?? "Away").slice(0, 22);
  const s1 = g("s1") ?? "0";
  const s2 = g("s2") ?? "0";
  const str1 = g("str1"), str2 = g("str2");
  const pens = g("pens");
  const potm = g("potm"), potmR = g("potmR");
  const sc = g("sc");

  const [pa, pb] = pens ? pens.split("-").map((n) => parseInt(n, 10)) : [NaN, NaN];
  const n1 = Number(s1), n2 = Number(s2);
  const aWon = pens ? pa > pb : n1 > n2;
  const bWon = pens ? pb > pa : n2 > n1;
  const c1 = aWon ? GREEN : bWon ? "#c4ccc6" : AMBER;
  const c2 = bWon ? GREEN : aWon ? "#c4ccc6" : AMBER;

  // Head-to-head stat rows (skip any not supplied). Possession shown as %.
  const statSpec: [string, string | null, boolean][] = [
    ["POSSESSION", g("pos"), true],
    ["SHOTS", g("sh"), false],
    ["ON TARGET", g("sot"), false],
    ["CORNERS", g("cor"), false],
    ["FOULS", g("fo"), false],
    ["OFFSIDES", g("off"), false],
    ["THROW-INS", g("thr"), false],
  ];
  const stats = statSpec
    .filter(([, v]) => v)
    .map(([label, v, pct]) => {
      const [a, b] = (v as string).split("-");
      return { label, a: pct ? `${a}%` : a, b: pct ? `${b}%` : b, an: Number(a), bn: Number(b) };
    })
    .slice(0, 6);

  // ── Portrait (9:16 — Instagram Stories / TikTok) ─────────────────────────
  if (portrait) {
    return new ImageResponse(
      (
        <div style={{ width: "1080px", height: "1920px", display: "flex", flexDirection: "column", alignItems: "center", background: "linear-gradient(180deg, #0a0a0f 0%, #0e1611 60%, #0a0a0f 100%)", fontFamily: "sans-serif", position: "relative" }}>
          {/* top accent bar */}
          <div style={{ width: "100%", height: 8, background: GREEN }} />

          {/* brand */}
          <div style={{ display: "flex", alignItems: "center", marginTop: 80 }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>YOUR</span>
            <span style={{ fontSize: 42, fontWeight: 800, color: GREEN, letterSpacing: 1 }}>SCORE</span>
            <span style={{ fontSize: 32, color: "#8a948f", fontWeight: 600, marginLeft: 16 }}>38-0 LIVE</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: AMBER, fontWeight: 700, letterSpacing: 3, marginTop: 12 }}>FULL TIME</div>

          {/* scoreline */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 80 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <span style={{ fontSize: 140, fontWeight: 900, color: c1, lineHeight: 1 }}>{s1}</span>
              <span style={{ fontSize: 80, fontWeight: 700, color: "#555" }}>–</span>
              <span style={{ fontSize: 140, fontWeight: 900, color: c2, lineHeight: 1 }}>{s2}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 80, marginTop: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 38, fontWeight: 800, color: c1, textAlign: "center", maxWidth: 420 }}>{p1}</span>
                {str1 ? <span style={{ fontSize: 26, color: "#8a948f", marginTop: 6 }}>{`STR ${str1}`}</span> : <span />}
              </div>
              <span style={{ fontSize: 32, color: "#555" }}>vs</span>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 38, fontWeight: 800, color: c2, textAlign: "center", maxWidth: 420 }}>{p2}</span>
                {str2 ? <span style={{ fontSize: 26, color: "#8a948f", marginTop: 6 }}>{`STR ${str2}`}</span> : <span />}
              </div>
            </div>
            {pens ? <div style={{ display: "flex", fontSize: 30, color: AMBER, marginTop: 20 }}>{`Penalties ${pens}`}</div> : <div />}
          </div>

          {/* MOTM */}
          {potm ? (
            <div style={{ display: "flex", marginTop: 60 }}>
              <div style={{ display: "flex", alignItems: "center", background: "rgba(255,184,0,0.12)", border: "2px solid rgba(255,184,0,0.4)", borderRadius: 20, padding: "16px 40px", gap: 16 }}>
                <span style={{ fontSize: 30, color: AMBER }}>MOTM</span>
                <span style={{ fontSize: 36, color: "#fff", fontWeight: 700 }}>{potm}</span>
                {potmR ? <span style={{ fontSize: 36, color: AMBER, fontWeight: 800 }}>{potmR}</span> : <span />}
              </div>
            </div>
          ) : <div />}

          {/* stats panel */}
          <div style={{ display: "flex", flexDirection: "column", width: 860, marginTop: 64 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <span style={{ width: 120, textAlign: "left", fontSize: 34, fontWeight: 800, color: s.an >= s.bn ? "#fff" : "#8a948f" }}>{s.a}</span>
                <span style={{ fontSize: 24, letterSpacing: 2, color: "#8a948f" }}>{s.label}</span>
                <span style={{ width: 120, textAlign: "right", fontSize: 34, fontWeight: 800, color: s.bn >= s.an ? "#fff" : "#8a948f" }}>{s.b}</span>
              </div>
            ))}
          </div>

          {/* footer */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "auto", marginBottom: 80, gap: 8 }}>
            {sc ? <div style={{ display: "flex", fontSize: 26, color: "#c4ccc6" }}>{`Goals: ${sc}`}</div> : <div />}
            <div style={{ display: "flex", fontSize: 34, color: GREEN, fontWeight: 700, letterSpacing: 1 }}>yourscore.app/38-0</div>
          </div>

          {/* bottom accent */}
          <div style={{ position: "absolute", left: 0, bottom: 0, width: "1080px", height: 8, background: GREEN }} />
        </div>
      ),
      { width: 1080, height: 1920 }
    );
  }

  // ── Landscape (16:9 — default OG/Twitter card) ────────────────────────────
  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #0e1611 100%)", padding: "44px 64px", fontFamily: "sans-serif", position: "relative" }}>
        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ color: "#fff" }}>YOUR</span>
            <span style={{ color: GREEN }}>SCORE</span>
            <span style={{ color: "#8a948f", marginLeft: 12, fontWeight: 600 }}>· 38-0 LIVE</span>
          </div>
          <div style={{ fontSize: 24, color: AMBER, fontWeight: 700, letterSpacing: 2 }}>FULL TIME</div>
        </div>

        {/* scoreline */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 360 }}>
            <div style={{ fontSize: 40, fontWeight: 800, color: c1, textAlign: "right", lineHeight: 1.05 }}>{p1}</div>
            {str1 ? <div style={{ fontSize: 22, color: "#8a948f", marginTop: 4 }}>{`STR ${str1}`}</div> : <div />}
          </div>
          <div style={{ display: "flex", alignItems: "center", margin: "0 30px" }}>
            <span style={{ fontSize: 96, fontWeight: 900, color: c1 }}>{s1}</span>
            <span style={{ fontSize: 56, fontWeight: 700, color: "#555", margin: "0 16px" }}>–</span>
            <span style={{ fontSize: 96, fontWeight: 900, color: c2 }}>{s2}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: 360 }}>
            <div style={{ fontSize: 40, fontWeight: 800, color: c2, lineHeight: 1.05 }}>{p2}</div>
            {str2 ? <div style={{ fontSize: 22, color: "#8a948f", marginTop: 4 }}>{`STR ${str2}`}</div> : <div />}
          </div>
        </div>

        {pens ? <div style={{ display: "flex", justifyContent: "center", marginTop: 8, fontSize: 24, color: AMBER }}>{`Penalties ${pens}`}</div> : <div />}

        {potm ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(255,184,0,0.12)", border: "2px solid rgba(255,184,0,0.4)", borderRadius: 16, padding: "8px 22px" }}>
              <span style={{ fontSize: 22, color: AMBER, marginRight: 10 }}>MOTM</span>
              <span style={{ fontSize: 26, color: "#fff", fontWeight: 700 }}>{potm}</span>
              {potmR ? <span style={{ fontSize: 26, color: AMBER, fontWeight: 800, marginLeft: 10 }}>{potmR}</span> : <span />}
            </div>
          </div>
        ) : <div />}

        {/* head-to-head stat panel */}
        <div style={{ display: "flex", flexDirection: "column", width: 760, alignSelf: "center", marginTop: 18 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ width: 90, textAlign: "left", fontSize: 26, fontWeight: 800, color: s.an >= s.bn ? "#fff" : "#8a948f" }}>{s.a}</span>
              <span style={{ fontSize: 20, letterSpacing: 1, color: "#8a948f" }}>{s.label}</span>
              <span style={{ width: 90, textAlign: "right", fontSize: 26, fontWeight: 800, color: s.bn >= s.an ? "#fff" : "#8a948f" }}>{s.b}</span>
            </div>
          ))}
        </div>

        {/* footer: scorers + url */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ display: "flex", maxWidth: 700, fontSize: 22, color: "#c4ccc6" }}>{sc ? `Goals: ${sc}` : "Build your XI. Go live, head-to-head."}</div>
          <div style={{ fontSize: 26, color: GREEN, fontWeight: 700 }}>yourscore.app/38-0</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: GREEN }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
