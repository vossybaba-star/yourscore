/**
 * gen-cover-placeholder.mjs — a simple TYPOGRAPHIC placeholder cover for the
 * "Perfect 10" hub tile (public/game-covers/perfect-10.webp), matching the
 * dimensions of the other game-type covers (900×900). No AI-generated
 * imagery — flat rectangles (a tapering tower motif) + the display font,
 * same idiom as the in-game tower. Replace with approved key art later.
 *
 * Usage: node scripts/perfect10/gen-cover-placeholder.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const FONT_PATH = join(ROOT, "scripts", "assets", "fonts", "BebasNeue-Regular.ttf");
const OUT_PATH = join(ROOT, "public", "game-covers", "perfect-10.webp");

const SIZE = 900;
const GOLD = "#ffc400";
const BG = "#0b0f14";

// Tapering tower bars — narrowest at top, widest at bottom, mirroring the
// in-game rung widths (62% → 100%).
const RUNGS = 10;
const barTop = 260;
const barHeight = 34;
const barGap = 8;
const bars = Array.from({ length: RUNGS }, (_, i) => {
  const rank = i + 1;
  const widthPct = 62 + ((rank - 1) * 38) / (RUNGS - 1);
  const w = (widthPct / 100) * (SIZE - 160);
  const x = (SIZE - w) / 2;
  const y = barTop + i * (barHeight + barGap);
  const opacity = 0.35 + (rank / RUNGS) * 0.55;
  return `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${barHeight}" rx="6" fill="${GOLD}" fill-opacity="${opacity.toFixed(2)}" />`;
}).join("\n");

const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.16" />
      <stop offset="100%" stop-color="${GOLD}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="${BG}" />
  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)" />
  ${bars}
  <text x="${SIZE / 2}" y="180" text-anchor="middle" font-family="Bebas Neue" font-size="112" fill="${GOLD}" letter-spacing="4">PERFECT 10</text>
  <text x="${SIZE / 2}" y="${barTop + RUNGS * (barHeight + barGap) + 60}" text-anchor="middle" font-family="Bebas Neue" font-size="34" fill="#8a6d1a" letter-spacing="6">NAME THE WHOLE TOP TEN</text>
</svg>
`;

const fontBuffer = readFileSync(FONT_PATH);
const resvg = new Resvg(svg, {
  font: { fontBuffers: [fontBuffer], loadSystemFonts: false, defaultFontFamily: "Bebas Neue" },
});
const png = resvg.render().asPng();

await sharp(png).webp({ quality: 92 }).toFile(OUT_PATH);
console.log(`Wrote ${OUT_PATH}`);
