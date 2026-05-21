import { NextResponse } from "next/server";

export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="#0a0a0f"/>
  <rect x="32" y="32" width="448" height="448" rx="72" fill="#12121e" stroke="rgba(0,255,135,0.15)" stroke-width="2"/>
  <text x="256" y="320" font-family="Arial Black, sans-serif" font-size="220" font-weight="900" fill="#00ff87" text-anchor="middle" letter-spacing="-4">YS</text>
</svg>`;

  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000" },
  });
}
