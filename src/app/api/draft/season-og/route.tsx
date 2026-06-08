/**
 * /api/draft/season-og — 38-0 season-result share card (portrait 1080x1500). The
 * viral moment: a broadcast graphic of the simulated season, designed to be saved
 * and posted to WhatsApp / X / socials. Stateless — all data comes from query params
 * (computed client-side) so shared links unfurl without a DB. Built on next/og.
 *
 * Params:
 *   w,d,l    record           pts        points
 *   pos      league position  ovr        team overall (strength)
 *   mode     'Normal'|'Expert'  inv      '1' for invincible
 *   boot     'Name~goals'     pots       'Name~goals~assists'
 *   xi       'POS~Name~OVR|POS~Name~OVR|…'  (11 entries, any order)
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type Line = "att" | "mid" | "def" | "gk";
function lineOf(pos: string): Line {
  const p = pos.toUpperCase();
  if (p === "GK") return "gk";
  if (["RW", "LW", "ST", "CF", "RF", "LF", "SS"].includes(p)) return "att";
  if (["CDM", "CM", "RCM", "LCM", "CAM", "RM", "LM", "DM", "AM"].includes(p)) return "mid";
  return "def";
}
const CHIP: Record<Line, string> = { att: "#ff5b6e", mid: "#00ff87", def: "#3da5ff", gk: "#ffb800" };

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const num = (k: string, d = 0) => { const n = parseInt(q.get(k) ?? "", 10); return Number.isFinite(n) ? n : d; };
  const w = num("w"), d = num("d"), l = num("l");
  const pts = num("pts"), pos = num("pos", 10), ovr = num("ovr");
  const inv = q.get("inv") === "1";
  const mode = q.get("mode") || "Normal";
  const wide = q.get("wide") === "1"; // landscape card for social unfurls
  const logo = `${req.nextUrl.origin}/logo-mark.png`; // transparent YourScore wordmark

  const accent = inv ? "#ffd700" : pos === 1 ? "#00ff87" : pos <= 4 ? "#22d3ee" : pos <= 7 ? "#a78bfa" : pos <= 12 ? "#ffb800" : "#ff4757";
  const tier = inv ? "INVINCIBLE" : pos === 1 ? "CHAMPIONS" : pos <= 4 ? "TOP FOUR" : pos <= 6 ? "EUROPE" : pos <= 17 ? "MID-TABLE" : "RELEGATED";

  // XI → two columns: attack+midfield on the left, defence+keeper on the right.
  const xi = (q.get("xi") ?? "").split("|").map((e) => {
    const [position, name, rating] = e.split("~");
    return { position: position ?? "", name: name ?? "", rating: rating ?? "", line: lineOf(position ?? "") };
  }).filter((p) => p.name);
  const order: Record<Line, number> = { att: 0, mid: 1, def: 2, gk: 3 };
  const left = xi.filter((p) => p.line === "att" || p.line === "mid").sort((a, b) => order[a.line] - order[b.line]);
  const right = xi.filter((p) => p.line === "def" || p.line === "gk").sort((a, b) => order[a.line] - order[b.line]);

  const [bootName, bootGoals] = (q.get("boot") ?? "").split("~");
  const [potsName, potsG, potsA] = (q.get("pots") ?? "").split("~");

  const Row = ({ p }: { p: { position: string; name: string; rating: string; line: Line } }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 50, height: 30, borderRadius: 7, background: CHIP[p.line], color: "#0a0a0f", fontSize: 18, fontWeight: 800, marginRight: 14 }}>{p.position}</div>
        <div style={{ fontSize: 27, color: "#fff", fontWeight: 600 }}>{p.name}</div>
      </div>
      <div style={{ fontSize: 28, color: Number(p.rating) >= 88 ? "#00ff87" : "#cfcfe6", fontWeight: 800 }}>{p.rating}</div>
    </div>
  );

  const Pill = ({ text, color }: { text: string; color: string }) => (
    <div style={{ display: "flex", alignItems: "center", padding: "8px 20px", borderRadius: 999, border: `2px solid ${color}66`, color, fontSize: 22, fontWeight: 700 }}>{text}</div>
  );

  // Compact row for the landscape (social-unfurl) layout.
  const RowW = ({ p }: { p: { position: string; name: string; rating: string; line: Line } }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 25, borderRadius: 6, background: CHIP[p.line], color: "#0a0a0f", fontSize: 15, fontWeight: 800, marginRight: 10 }}>{p.position}</div>
        <div style={{ display: "flex", fontSize: 21, color: "#fff", fontWeight: 600 }}>{p.name}</div>
      </div>
      <div style={{ display: "flex", fontSize: 21, color: Number(p.rating) >= 88 ? "#00ff87" : "#cfcfe6", fontWeight: 800 }}>{p.rating}</div>
    </div>
  );

  // Landscape card — used for the social unfurl (Twitter/X shows summary_large_image
  // at ~1.91:1, which would crop a portrait's hero record). Here the W-D-L is the
  // headline, on the left, so it's always visible. Portrait (below) is kept for the
  // in-app preview + "save image".
  if (wide) {
    return new ImageResponse(
      (
        <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(150deg, #0c0c12 0%, #07110d 100%)", padding: "40px 52px", fontFamily: "sans-serif", position: "relative" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ display: "flex", fontSize: 40, fontWeight: 900, color: "#fff", letterSpacing: 1 }}>38-0</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} width={97} height={26} alt="YourScore" style={{ display: "flex", marginLeft: 16 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Pill text={mode} color="#8b8ba6" />
              <div style={{ display: "flex", width: 12 }} />
              <Pill text={`OVR ${ovr}`} color="#00ff87" />
            </div>
          </div>

          {/* body: hero record (left) + XI (right) */}
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", width: 470 }}>
              <span style={{ display: "flex", fontSize: 20, color: "#8888aa", letterSpacing: 3 }}>SEASON RECORD</span>
              <span style={{ display: "flex", fontSize: 132, fontWeight: 900, color: "#fff", lineHeight: 1, marginTop: 4 }}>{w}-{d}-{l}</span>
              <span style={{ display: "flex", fontSize: 20, color: "#8888aa", letterSpacing: 2, marginTop: 4 }}>WON · DRAWN · LOST</span>
              <div style={{ display: "flex", alignItems: "baseline", marginTop: 16 }}>
                <span style={{ display: "flex", color: accent, fontWeight: 800, fontSize: 28 }}>{pts} pts</span>
                <span style={{ display: "flex", color: "#8888aa", margin: "0 10px", fontSize: 28 }}>·</span>
                <span style={{ display: "flex", color: "#cfcfe6", fontSize: 28 }}>finished {ordinal(pos)}</span>
              </div>
              <div style={{ display: "flex", marginTop: 18, padding: "10px 28px", borderRadius: 999, background: `${accent}1f`, border: `2px solid ${accent}66`, color: accent, fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>{tier}</div>
            </div>

            <div style={{ display: "flex", width: 600, justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", width: 290 }}>{left.map((p, i) => <RowW key={i} p={p} />)}</div>
              <div style={{ display: "flex", flexDirection: "column", width: 290 }}>{right.map((p, i) => <RowW key={i} p={p} />)}</div>
            </div>
          </div>

          {/* footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {bootName ? <span style={{ display: "flex", fontSize: 20, color: "#cfcfe6", marginRight: 26 }}>👟 {bootName} · {bootGoals}</span> : <span style={{ display: "flex" }} />}
              {potsName ? <span style={{ display: "flex", fontSize: 20, color: "#cfcfe6" }}>🏆 {potsName}</span> : <span style={{ display: "flex" }} />}
            </div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span style={{ display: "flex", fontSize: 22, color: "#8888aa", marginRight: 14 }}>Think you can beat this?</span>
              <span style={{ display: "flex", fontSize: 26, color: "#00ff87", fontWeight: 900 }}>yourscore.app</span>
            </div>
          </div>

          <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  return new ImageResponse(
    (
      <div style={{ width: "1080px", height: "1360px", display: "flex", flexDirection: "column", background: "linear-gradient(160deg, #0c0c12 0%, #07110d 100%)", padding: "56px 64px", fontFamily: "sans-serif", position: "relative" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ display: "flex", fontSize: 52, fontWeight: 900, color: "#fff", letterSpacing: 1 }}>38-0</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} width={119} height={32} alt="YourScore" style={{ display: "flex", marginLeft: 18 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Pill text={mode} color="#8b8ba6" />
            <div style={{ display: "flex", width: 14 }} />
            <Pill text={`OVR ${ovr}`} color="#00ff87" />
          </div>
        </div>

        {/* hero record */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 36 }}>
          <div style={{ display: "flex", fontSize: 168, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{w}-{d}-{l}</div>
          <div style={{ display: "flex", fontSize: 26, color: "#8888aa", letterSpacing: 3, marginTop: 6 }}>WON · DRAWN · LOST</div>
          <div style={{ display: "flex", fontSize: 34, marginTop: 18 }}>
            <span style={{ color: accent, fontWeight: 800 }}>{pts} pts</span>
            <span style={{ color: "#8888aa", margin: "0 12px" }}>·</span>
            <span style={{ color: "#cfcfe6" }}>finished {ordinal(pos)}</span>
          </div>
          <div style={{ display: "flex", marginTop: 20, padding: "12px 36px", borderRadius: 999, background: `${accent}1f`, border: `2px solid ${accent}66`, color: accent, fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>{tier}</div>
        </div>

        {/* the XI */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 440 }}>{left.map((p, i) => <Row key={i} p={p} />)}</div>
          <div style={{ display: "flex", flexDirection: "column", width: 440 }}>{right.map((p, i) => <Row key={i} p={p} />)}</div>
        </div>

        {/* awards */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 440, padding: "20px 24px", borderRadius: 18, background: "#11131c" }}>
            <div style={{ display: "flex", fontSize: 19, color: "#8888aa", letterSpacing: 1 }}>👟 GOLDEN BOOT</div>
            <div style={{ display: "flex", fontSize: 28, color: "#fff", fontWeight: 700, marginTop: 6 }}>{bootName || "—"}</div>
            <div style={{ display: "flex", fontSize: 22, color: "#ffb800", marginTop: 2 }}>{bootGoals ? `${bootGoals} goals` : ""}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: 440, padding: "20px 24px", borderRadius: 18, background: "#11131c" }}>
            <div style={{ display: "flex", fontSize: 19, color: "#8888aa", letterSpacing: 1 }}>🏆 PLAYER OF THE SEASON</div>
            <div style={{ display: "flex", fontSize: 28, color: "#fff", fontWeight: 700, marginTop: 6 }}>{potsName || "—"}</div>
            <div style={{ display: "flex", fontSize: 22, color: "#00ff87", marginTop: 2 }}>{potsName ? `${potsG || 0}G · ${potsA || 0}A` : ""}</div>
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 24, color: "#00ff87", fontWeight: 700 }}>✅ Verified result</div>
          <div style={{ display: "flex", fontSize: 26, color: "#cfcfe6", marginTop: 10 }}>Think you can beat this?</div>
          <div style={{ display: "flex", fontSize: 40, color: "#00ff87", fontWeight: 900, marginTop: 8 }}>yourscore.app</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1080px", height: 12, background: accent }} />
      </div>
    ),
    { width: 1080, height: 1500 }
  );
}
