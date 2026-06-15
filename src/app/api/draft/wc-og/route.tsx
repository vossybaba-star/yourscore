/**
 * /api/draft/wc-og — World Cup Run shareable scorecard (1200x630). Renders the run's
 * outcome (champions / knocked out / stage reached) plus the full path (each stage's
 * result). The "I went on a run with Scotland" graphic.
 *
 * Query params: nation, crest, status ('champion'|'eliminated'|'active'), stage,
 *   path = "Label~Detail~R|..."  (R = W|L|Q), e.g. "Group~6 pts~Q|R32~2-1~W|SF~1-2~L"
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const STAGE_LABEL: Record<string, string> = {
  group: "Group Stage", ko: "Knockouts", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-Final", sf: "Semi-Final", final: "Final",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const nation = q.get("nation") ?? "Your nation";
  const crest = q.get("crest");
  const world = q.get("world") === "1";
  const stage = q.get("stage") ?? "group";
  const status = q.get("status") ?? "active";
  const stageLabel = STAGE_LABEL[stage] ?? "Group Stage";

  const champion = status === "champion";
  const eliminated = status === "eliminated";
  const accent = champion ? "#ffd700" : eliminated ? "#ff4757" : "#aeea00";
  const headline = champion ? "CHAMPIONS" : eliminated ? "OUT" : stageLabel.toUpperCase();
  // World mode has no nation; refer to it as "a World XI" for natural copy.
  const who = world ? "A World XI" : nation;
  const sub = champion ? `${who} won the World Cup 🏆`
    : eliminated ? `${who} — out at the ${stageLabel}`
    : `${who} reached the ${stageLabel}`;

  // Parse the path: each row "Label~Detail~R".
  const rows = (q.get("path") ?? "").split("|").filter(Boolean).map((r) => {
    const [label, detail, res] = r.split("~");
    return { label, detail, res };
  });
  const resColor = (r: string) => (r === "L" ? "#ff4757" : r === "Q" ? "#ffd700" : "#aeea00");

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #0e1611 100%)", padding: "56px 64px", fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ color: "#fff" }}>YOUR</span>
          <span style={{ color: "#aeea00" }}>SCORE</span>
          <span style={{ color: "#8a948f", marginLeft: 16, fontWeight: 600 }}>· WORLD CUP RUN</span>
        </div>

        <div style={{ display: "flex", marginTop: 36, flex: 1 }}>
          {/* Left: nation + outcome */}
          <div style={{ display: "flex", flexDirection: "column", width: 560, justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={crest} alt="" width={96} height={96} style={{ objectFit: "contain", marginRight: 22 }} />
              ) : world ? (
                <div style={{ display: "flex", fontSize: 84, marginRight: 22 }}>🌍</div>
              ) : null}
              <div style={{ fontSize: 52, fontWeight: 800, color: "#fff" }}>{nation}</div>
            </div>
            <div style={{ fontSize: champion ? 120 : 132, fontWeight: 900, color: accent, lineHeight: 1, marginTop: 18 }}>{headline}</div>
            <div style={{ fontSize: 30, color: "#c4ccc6", marginTop: 18, display: "flex" }}>{sub}</div>
          </div>

          {/* Right: the run scorecard */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 40, justifyContent: "center" }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "12px 0" }}>
                <div style={{ display: "flex", fontSize: 24, color: "#8a948f", width: 150 }}>{row.label}</div>
                <div style={{ display: "flex", flex: 1, fontSize: 30, fontWeight: 700, color: "#fff" }}>{row.detail}</div>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 800, color: resColor(row.res) }}>{row.res}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 30, color: "#c4ccc6", display: "flex" }}>Pick a nation. Win the World Cup.</div>
          <div style={{ fontSize: 30, color: "#aeea00", fontWeight: 700 }}>yourscore.app/38-0/wc</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
