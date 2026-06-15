/**
 * /api/draft/og — Draft XI share image (1200x630). The growth engine: every shared
 * H2H result / standing renders a broadcast-style graphic with the YourScore
 * watermark. Built on next/og (ships with Next 14 — no extra dependency).
 *
 * Query params (all optional, safe defaults):
 *   strength, tier, formation, result ('win'|'loss'), you, opp, youStr, oppStr, rank
 *
 * Used both as the og:image on /draft/match/[id] + /draft/team pages and as a
 * direct share target.
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const TIER_COLOR: Record<string, string> = {
  INVINCIBLE: "#ffd700",
  Centurions: "#aeea00",
  Champions: "#aeea00",
  "Title Challengers": "#aeea00",
  Europe: "#aeea00",
  "Mid-table": "#ffb800",
  "Relegation Battle": "#ff8a3d",
  Relegated: "#ff4757",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const result = q.get("result"); // 'win' | 'loss' | null
  const tier = q.get("tier") ?? "Champions";
  const strength = q.get("strength") ?? "";
  const formation = q.get("formation") ?? "";
  const you = q.get("you") ?? "Your XI";
  const opp = q.get("opp");
  const youStr = q.get("youStr") ?? strength;
  const oppStr = q.get("oppStr");
  const rank = q.get("rank");
  const accent = result === "loss" ? "#ff4757" : TIER_COLOR[tier] ?? "#aeea00";

  const headline = result === "win" ? "WIN" : result === "loss" ? "LOSS" : tier;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #0a0a0f 0%, #0e1611 100%)",
          padding: "64px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* top brand row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ color: "#fff" }}>YOUR</span>
            <span style={{ color: "#aeea00" }}>SCORE</span>
            <span style={{ color: "#8a948f", marginLeft: 16, fontWeight: 600 }}>· DRAFT XI</span>
          </div>
          {formation ? (
            <div style={{ fontSize: 30, color: "#8a948f" }}>{formation}</div>
          ) : (
            <div />
          )}
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 70 }}>
          <div style={{ fontSize: 150, fontWeight: 900, color: accent, lineHeight: 1 }}>{headline}</div>
          {result && opp ? (
            <div style={{ fontSize: 44, color: "#fff", marginTop: 28, display: "flex" }}>
              <span style={{ color: accent, fontWeight: 800 }}>{you} {youStr}</span>
              <span style={{ color: "#8a948f", margin: "0 16px" }}>
                {result === "win" ? "beat" : "lost to"}
              </span>
              <span style={{ fontWeight: 800 }}>{opp} {oppStr}</span>
            </div>
          ) : (
            <div style={{ fontSize: 44, color: "#c4ccc6", marginTop: 28, display: "flex" }}>
              {strength ? `Strength ${strength}` : "Build your all-time Premier League XI"}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ fontSize: 34, color: "#fff", display: "flex" }}>
            {rank ? (
              <span style={{ display: "flex" }}>
                Ranked
                <span style={{ color: accent, fontWeight: 800, margin: "0 12px" }}>#{rank}</span>
                today
              </span>
            ) : (
              <span style={{ color: "#c4ccc6" }}>Spin. Draft. Beat the world.</span>
            )}
          </div>
          <div style={{ fontSize: 32, color: "#aeea00", fontWeight: 700 }}>yourscore.app/draft</div>
        </div>

        {/* accent bar */}
        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
