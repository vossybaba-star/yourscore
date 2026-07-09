/**
 * /api/og/blog?title=... — link-preview image for blog posts (1200x630).
 *
 * Deliberately a plain typographic plate (gold on deep pitch) — no artwork.
 * Generated imagery never ships without contact-sheet approval; type-only
 * plates are exempt. Posts can override with an `ogImage` frontmatter field.
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GOLD = "#ffc233";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get("title") ?? "The YourScore Blog").slice(0, 120);

  // Long headlines step down so the plate never overflows.
  const fontSize = title.length > 70 ? 56 : title.length > 40 ? 68 : 84;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(150deg, #080d0a 0%, #0b1a12 55%, #08130d 100%)",
          fontFamily: "sans-serif",
          position: "relative",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={240} height={64} alt="YourScore" style={{ display: "flex" }} />
          <div
            style={{
              display: "flex",
              padding: "10px 26px",
              borderRadius: 999,
              background: "rgba(255,194,51,0.10)",
              border: `1px solid ${GOLD}55`,
            }}
          >
            <span style={{ display: "flex", color: GOLD, fontSize: 24, fontWeight: 800, letterSpacing: 4 }}>
              BLOG
            </span>
          </div>
        </div>

        <span
          style={{
            display: "flex",
            fontSize,
            fontWeight: 900,
            color: GOLD,
            lineHeight: 1.1,
            letterSpacing: -1,
            maxWidth: "1000px",
          }}
        >
          {title}
        </span>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", fontSize: 26, color: "#c4ccc6", fontWeight: 600 }}>
            Football knowledge, settled.
          </span>
          <span style={{ display: "flex", fontSize: 26, color: GOLD, fontWeight: 800 }}>
            yourscore.app/blog
          </span>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: GOLD }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
