/**
 * /api/draft/wc-og — World Cup Run share card (1200x630). Renders a nation's run
 * result: champions, knocked out at a stage, or a stage reached. The shareable
 * "I went on a run with Morocco" graphic.
 *
 * Query params (all optional): nation, crest, stage, status ('champion'|'eliminated'|
 * 'active'), opp, g (scoreline e.g. "3-1").
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const STAGE_LABEL: Record<string, string> = {
  group: "Group Stage", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-Final", sf: "Semi-Final", final: "Final",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const nation = q.get("nation") ?? "Your nation";
  const crest = q.get("crest");
  const stage = q.get("stage") ?? "group";
  const status = q.get("status") ?? "active";
  const opp = q.get("opp");
  const score = q.get("g");
  const stageLabel = STAGE_LABEL[stage] ?? "Group Stage";

  const champion = status === "champion";
  const eliminated = status === "eliminated";
  const accent = champion ? "#ffd700" : eliminated ? "#ff4757" : "#00ff87";
  const headline = champion ? "WORLD CHAMPIONS" : eliminated ? "KNOCKED OUT" : stageLabel.toUpperCase();
  const sub = champion
    ? `${nation} won the World Cup 🏆`
    : eliminated
      ? `${nation} — out at the ${stageLabel}`
      : `${nation} reached the ${stageLabel}`;

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #12121e 100%)", padding: "64px", fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ color: "#fff" }}>YOUR</span>
            <span style={{ color: "#00ff87" }}>SCORE</span>
            <span style={{ color: "#8888aa", marginLeft: 16, fontWeight: 600 }}>· WORLD CUP RUN</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: 60 }}>
          {crest ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crest} alt="" width={160} height={160} style={{ objectFit: "contain", marginRight: 40 }} />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: champion ? 92 : 104, fontWeight: 900, color: accent, lineHeight: 1 }}>{headline}</div>
            <div style={{ fontSize: 42, color: "#cfcfe6", marginTop: 22, display: "flex" }}>{sub}</div>
            {opp && score ? (
              <div style={{ fontSize: 36, color: "#8888aa", marginTop: 14, display: "flex" }}>vs {opp} · {score}</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ fontSize: 34, color: "#cfcfe6", display: "flex" }}>Pick a nation. Win the World Cup.</div>
          <div style={{ fontSize: 32, color: "#00ff87", fontWeight: 700 }}>yourscore.app/38-0/wc</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
