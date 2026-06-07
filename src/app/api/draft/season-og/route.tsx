/**
 * /api/draft/season-og — Draft XI season-result share image (1200x630). The viral
 * moment for the solo game: a broadcast graphic of how the simulated season went.
 * Stateless — all data comes from query params (the result is computed client-side),
 * so shared links unfurl without a DB. Built on next/og (ships with Next 14).
 *
 * Params: pos, pts, w, d, l, gf, ga, head, verdict, boot, inv ('1'), formation.
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const num = (k: string, d = 0) => { const n = parseInt(q.get(k) ?? "", 10); return Number.isFinite(n) ? n : d; };
  const pos = num("pos", 10);
  const pts = num("pts");
  const w = num("w"), d = num("d"), l = num("l");
  const gf = num("gf"), ga = num("ga");
  const inv = q.get("inv") === "1";
  const head = q.get("head") ?? "SEASON SIMULATED";
  const verdict = q.get("verdict") ?? "";
  const boot = q.get("boot");
  const formation = q.get("formation") ?? "";

  const accent = inv ? "#ffd700" : pos === 1 ? "#00ff87" : pos <= 4 ? "#22d3ee" : pos <= 7 ? "#a78bfa" : pos <= 12 ? "#ffb800" : "#ff4757";
  const verdictColor = verdict === "OVERPERFORMED" ? "#00ff87" : verdict === "UNDERPERFORMED" ? "#ff4757" : "#8888aa";

  const Stat = ({ label, value, color }: { label: string; value: string; color: string }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 64, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 24, color: "#8888aa", marginTop: 4 }}>{label}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #12121e 100%)", padding: "56px 64px", fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ color: "#fff" }}>YOUR</span><span style={{ color: "#00ff87" }}>SCORE</span>
            <span style={{ color: "#8888aa", marginLeft: 16, fontWeight: 600 }}>· DRAFT XI</span>
          </div>
          <div style={{ fontSize: 26, color: "#8888aa" }}>{formation || "SEASON"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 40 }}>
          <div style={{ fontSize: inv ? 120 : 64, fontWeight: 900, color: accent, lineHeight: 1 }}>{head}</div>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 24, fontSize: 44, color: "#fff" }}>
            <span style={{ fontWeight: 800 }}>Finished {ordinal(pos)}</span>
            <span style={{ color: "#8888aa", margin: "0 16px" }}>·</span>
            <span style={{ fontWeight: 800, color: accent }}>{pts} pts</span>
            {verdict ? <span style={{ fontSize: 28, color: verdictColor, marginLeft: 24 }}>{verdict}</span> : <span />}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", marginBottom: 8 }}>
          <Stat label="WINS" value={String(w)} color="#00ff87" />
          <Stat label="DRAWS" value={String(d)} color="#ffb800" />
          <Stat label="LOSSES" value={String(l)} color="#ff4757" />
          <Stat label="FOR" value={String(gf)} color="#00ff87" />
          <Stat label="AGAINST" value={String(ga)} color="#ff4757" />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 28 }}>
          <div style={{ fontSize: 28, color: "#cfcfe6", display: "flex" }}>
            {boot ? <span style={{ display: "flex" }}>👟 Golden Boot:<span style={{ color: "#fff", fontWeight: 700, marginLeft: 10 }}>{boot}</span></span> : <span style={{ color: "#cfcfe6" }}>Spin. Draft. Simulate your season.</span>}
          </div>
          <div style={{ fontSize: 30, color: "#00ff87", fontWeight: 700 }}>yourscore.app/draft</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
