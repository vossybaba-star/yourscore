/**
 * /api/draft/promo-og — marketing graphic for the 38-0 game (1600x900, Twitter/X).
 * Built on the app's real brand system so the asset is on-brand by construction.
 * Satori-safe: single linear-gradient bg, every text node wrapped in a span.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

const GREEN = "#aeea00";

export async function GET() {
  const Pill = ({ children }: { children: string }) => (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 22px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)" }}>
      <span style={{ color: "#eef2f0", fontSize: 28, fontWeight: 600 }}>{children}</span>
    </div>
  );
  const Badge = ({ ovr, name, color, sub }: { ovr: string; name: string; color: string; sub: string }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 240, paddingTop: 28, paddingBottom: 28, borderRadius: 28, background: "rgba(255,255,255,0.04)", border: `2px solid ${color}55` }}>
      <span style={{ fontSize: 100, fontWeight: 900, color, lineHeight: 1 }}>{ovr}</span>
      <span style={{ fontSize: 22, color: "#9aa39d", letterSpacing: 3, marginTop: 6 }}>OVR</span>
      <span style={{ fontSize: 30, color: "#fff", fontWeight: 700, marginTop: 18 }}>{name}</span>
      <span style={{ fontSize: 20, color: "#9aa39d", marginTop: 4 }}>{sub}</span>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "1600px", height: "900px", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(140deg, #0a0a0f 0%, #0b1a12 55%, #08130d 100%)", padding: "70px 80px", fontFamily: "sans-serif", position: "relative" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ color: "#fff", fontSize: 46, fontWeight: 900, letterSpacing: 1 }}>YOUR</span>
            <span style={{ color: GREEN, fontSize: 46, fontWeight: 900, letterSpacing: 1 }}>SCORE</span>
            <span style={{ color: "#9aa39d", fontSize: 30, fontWeight: 700, marginLeft: 18 }}>· 38-0</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "10px 24px", borderRadius: 999, background: "rgba(174,234,0,0.12)", border: `1px solid ${GREEN}66` }}>
            <div style={{ display: "flex", width: 14, height: 14, borderRadius: 999, background: GREEN, marginRight: 12 }} />
            <span style={{ color: GREEN, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>LIVE NOW</span>
          </div>
        </div>

        {/* body */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 860 }}>
            <span style={{ fontSize: 94, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: -1 }}>BUILD YOUR</span>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span style={{ fontSize: 94, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: -1 }}>ALL-TIME</span>
              <span style={{ fontSize: 94, fontWeight: 900, color: GREEN, lineHeight: 1, letterSpacing: -1, marginLeft: 22 }}>XI.</span>
            </div>
            <span style={{ fontSize: 38, color: "#c4ccc6", fontWeight: 600, marginTop: 24 }}>Then prove it&apos;s the best — head-to-head.</span>
            <div style={{ display: "flex", marginTop: 40 }}>
              <div style={{ display: "flex", marginRight: 16 }}><Pill>⚔️ 1v1 head-to-head</Pill></div>
              <div style={{ display: "flex", marginRight: 16 }}><Pill>🏆 Your own leagues</Pill></div>
              <div style={{ display: "flex" }}><Pill>⚽ 20 yrs of legends</Pill></div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            <Badge ovr="86" name="YOUR XI" color={GREEN} sub="Top four" />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 96 }}>
              <span style={{ fontSize: 52, fontWeight: 900, color: "#9aa39d" }}>VS</span>
            </div>
            <Badge ovr="83" name="A RIVAL" color="#aeea00" sub="Mid-table" />
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 34 }}>
          <span style={{ fontSize: 34, color: "#9aa39d" }}>Spin. Draft. Beat the world.</span>
          <span style={{ fontSize: 46, fontWeight: 900, color: GREEN }}>YourScore.app</span>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1600px", height: 12, background: GREEN }} />
      </div>
    ),
    { width: 1600, height: 900 }
  );
}
