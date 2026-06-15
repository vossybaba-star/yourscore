/**
 * /api/og/home — the site's social link-preview image (1200x630).
 *
 * Sharing yourscore.app had no og:image, so socials showed a blank card. This is
 * the branded unfurl: the YourScore wordmark, the viral "38-0" hook, and a short
 * tagline. Referenced from the root metadata (layout + homepage).
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GREEN = "#aeea00";

export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(150deg, #0a0a0f 0%, #0b1a12 55%, #08130d 100%)", fontFamily: "sans-serif", position: "relative", padding: "60px" }}>
        {/* logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_DATA_URI} width={340} height={91} alt="YourScore" style={{ display: "flex" }} />

        {/* hero */}
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 36 }}>
          <span style={{ display: "flex", fontSize: 196, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: -4 }}>38</span>
          <span style={{ display: "flex", fontSize: 196, fontWeight: 900, color: "#9aa39d", lineHeight: 1, letterSpacing: -4, margin: "0 6px" }}>-</span>
          <span style={{ display: "flex", fontSize: 196, fontWeight: 900, color: GREEN, lineHeight: 1, letterSpacing: -4 }}>0</span>
        </div>

        {/* label */}
        <div style={{ display: "flex", marginTop: 8, padding: "10px 30px", borderRadius: 999, background: "rgba(174,234,0,0.1)", border: `1px solid ${GREEN}55` }}>
          <span style={{ display: "flex", color: GREEN, fontSize: 30, fontWeight: 800, letterSpacing: 4 }}>GO UNBEATEN</span>
        </div>

        {/* tagline */}
        <span style={{ display: "flex", fontSize: 32, color: "#c4ccc6", fontWeight: 600, marginTop: 36 }}>Build your all-time XI. Beat the world, head-to-head.</span>

        {/* footer */}
        <span style={{ display: "flex", fontSize: 28, color: GREEN, fontWeight: 800, marginTop: 40 }}>yourscore.app</span>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: GREEN }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
