import { NextResponse } from "next/server";

// Generates a simple SVG-based icon and serves it as PNG via canvas.
// For production, replace public/icon-192.png and public/icon-512.png with
// proper designed assets.
export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#0a0a0f"/>
  <rect x="16" y="16" width="160" height="160" rx="28" fill="#12121e" stroke="rgba(0,255,135,0.15)" stroke-width="1"/>
  <text x="96" y="118" font-family="Arial Black, sans-serif" font-size="80" font-weight="900" fill="#00ff87" text-anchor="middle" letter-spacing="-2">YS</text>
</svg>`;

  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000" },
  });
}
