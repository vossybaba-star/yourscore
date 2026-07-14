/**
 * gen-club-cover.mjs — 1080×1080 in-app cover for a Premier League CLUB quiz,
 * in the founder-locked cover style (designed card, NOT a raw photo):
 *   1. gpt-image-1 paints a text-free vintage matchday-poster background in the
 *      club's colours (S2 base style; football-only; calm negative space top-left,
 *      clean bottom-right for the crest).
 *   2. satori→resvg stamps the YourScore logo + club name on black plates
 *      (last word mint accent) + a "PREMIER LEAGUE · 2025/26" strip — identical
 *      treatment to gen-quiz-images.mjs so the whole library matches.
 *   3. sharp composites the REAL club crest (public/badges/<slug>.png) on a cream
 *      rounded plate in the lower-right — never model-drawn (founder rule).
 *
 * Usage: node --env-file=.env.local scripts/gen-club-cover.mjs --club "Arsenal" [--out /tmp] [--quality high|medium|low] [--reuse-bg]
 * Prints: COVER=<path>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { slugify, ACCENT_HEX } from "./lib/quiz-launch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS = join(__dirname, "assets", "fonts");
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const CLUB = flag("--club");
const OUT = flag("--out") || "/tmp";
const QUALITY = flag("--quality") || "high";
const REUSE_BG = args.includes("--reuse-bg");
const SERIES_LABEL = flag("--series") || "PREMIER LEAGUE 2025/26";
if (!CLUB) { console.error('Usage: gen-club-cover.mjs --club "Arsenal"'); process.exit(1); }
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

// Club colour worlds for the poster palette — kept to the real kit colours.
const CLUB_COLORS = {
  "Arsenal": "bright pillar-box red, white and gold",
  "Aston Villa": "claret and sky blue with gold",
  "Bournemouth": "red and black stripes with gold",
  "Brentford": "red, white and dark navy",
  "Brighton": "blue and white with a warm yellow accent",
  "Burnley": "claret and sky blue",
  "Chelsea": "royal blue and white",
  "Crystal Palace": "red and blue with gold",
  "Everton": "royal blue and white",
  "Fulham": "clean white and black",
  "Leeds United": "white, royal blue and yellow",
  "Liverpool": "deep red and gold",
  "Manchester City": "sky blue and white",
  "Manchester United": "red, white and black",
  "Newcastle United": "black and white stripes with silver",
  "Nottingham Forest": "bright red and white",
  "Sunderland": "red and white stripes",
  "Tottenham Hotspur": "navy blue and white",
  "West Ham United": "claret and sky blue",
  "Wolverhampton Wanderers": "gold and black",
};
const palette = CLUB_COLORS[CLUB] || "bold team colours, cream and near-black";

const slug = slugify(CLUB);
const badgePath = join(ROOT, "public", "badges", `${slug}.png`);
if (!existsSync(badgePath)) { console.error(`No crest at ${badgePath}`); process.exit(1); }

const words = CLUB.toUpperCase().split(/\s+/);
const bebas = readFileSync(join(FONTS, "BebasNeue-Regular.ttf"));
const dmBold = readFileSync(join(FONTS, "DMSans-Bold.ttf"));
const logoDataUri = `data:image/png;base64,${readFileSync(join(ROOT, "public", "logo.png")).toString("base64")}`;

// ── 1. Background (no text/logo/crest) ───────────────────────────────────────
const NO_TEXT = `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO badges, NO crests, NO watermarks anywhere. Keep the upper-left third calmer, darker negative space for a title. This is ASSOCIATION FOOTBALL (soccer) ONLY: any ball must be a round soccer ball with classic panels — NEVER an American football, NO egg-shaped balls, NO gridiron, NO helmets, NO shoulder pads.`;
function bgPrompt() {
  // The crest becomes the HERO of the composition — the poster is built to frame a
  // large central emblem: converging floodlight rays and a soft spotlight glow in the
  // middle, calmer there so the crest reads as part of the artwork (not a pasted logo).
  return `Flat graphic illustration in vintage football matchday-poster style: bold simplified geometric shapes, screen-print grain texture, limited palette of ${palette}. Composition built around a large central circular emblem area — dramatic floodlight rays and beams converging toward the middle with a soft spotlight glow, a stylised stadium and halftone crowd texture along the lower edge, subtle round soccer balls as small accents. The centre is a calmer spotlit medallion so a big club emblem can sit INTO the poster as its centrepiece. Mid-century poster composition, thick shapes, no gradients, premium editorial finish. ${NO_TEXT}`;
}

async function genBackground(size) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1", prompt: bgPrompt(), size, quality: QUALITY, n: 1 }),
      });
      const j = await res.json();
      if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
      return Buffer.from(j.data[0].b64_json, "base64");
    } catch (e) { lastErr = e; if (attempt < 4) await new Promise((r) => setTimeout(r, 5000 * attempt)); }
  }
  throw lastErr;
}

// ── 2. Branded overlay (satori → resvg) — mirrors gen-quiz-images.mjs ─────────
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });
function overlayTree(W, H) {
  const pad = Math.round(W * 0.045);
  const logoH = Math.round(W * 0.065);
  const subSize = Math.round(W * 0.024);
  const n = words.length;
  const shrink = n <= 2 ? 1 : n === 3 ? 0.84 : n === 4 ? 0.72 : 0.62;
  const titleSize = Math.round(W * 0.135 * shrink);
  const titleWidth = Math.round(W * 0.7);
  const titleWords = words.map((w, i) =>
    h("div", { style: { display: "flex", color: i === n - 1 ? ACCENT_HEX : "#ffffff",
      backgroundColor: "rgba(6,8,7,0.92)",
      paddingTop: Math.round(titleSize * 0.05), paddingBottom: Math.round(titleSize * 0.07),
      paddingLeft: Math.round(titleSize * 0.12), paddingRight: Math.round(titleSize * 0.12),
      marginRight: Math.round(titleSize * 0.07) } }, w)
  );
  return h("div", { style: { width: W, height: H, display: "flex", flexDirection: "column",
    justifyContent: "flex-start", padding: pad, fontFamily: "Bebas Neue", position: "relative" } },
    // No YourScore logo — the club name + crest carry the identity (founder call).
    h("div", { style: { display: "flex", flexWrap: "wrap", width: titleWidth, fontSize: titleSize, lineHeight: 0.9, rowGap: Math.round(titleSize * 0.04) } }, ...titleWords),
    h("div", { style: { display: "flex", alignItems: "center", alignSelf: "flex-start", marginTop: Math.round(H * 0.022),
      fontFamily: "DM Sans", fontWeight: 700, fontSize: subSize, letterSpacing: subSize * 0.35, color: ACCENT_HEX,
      backgroundColor: "rgba(6,8,7,0.92)",
      paddingTop: Math.round(subSize * 0.35), paddingBottom: Math.round(subSize * 0.35),
      paddingLeft: Math.round(subSize * 0.55), paddingRight: Math.round(subSize * 0.55) } },
      h("div", { style: { display: "flex", width: Math.round(W * 0.03), height: 3, backgroundColor: ACCENT_HEX, marginRight: subSize * 0.6 } }),
      h("div", { style: { display: "flex" } }, SERIES_LABEL)
    )
  );
}
async function renderOverlay(W, H) {
  const svg = await satori(overlayTree(W, H), { width: W, height: H, fonts: [
    { name: "Bebas Neue", data: bebas, weight: 400, style: "normal" },
    { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
  ] });
  return new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
}

// ── 3. Hero crest — the REAL crest worked INTO the artwork (no plate) ─────────
// Large and central, sat in the poster's spotlit medallion, then unified with the
// same screen-print grain as the art so it reads as part of the illustration.
const CREST_SIZE = 0.6; // fraction of width — the dominant centrepiece
async function heroCrest(W) {
  const size = Math.round(W * CREST_SIZE);
  return sharp(badgePath).resize(size, size, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
}

// A screen-print grain layer, composited over BOTH the art and the crest so the
// crest picks up the poster's texture and doesn't sit apart like a clean sticker.
function grainLayer(W, H) {
  const buf = Buffer.allocUnsafe(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = 90 + Math.floor(Math.random() * 76); // grain around mid-grey
    buf[i * 4] = v; buf[i * 4 + 1] = v; buf[i * 4 + 2] = v; buf[i * 4 + 3] = 30; // ~12% strength
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

// ── Compose ──────────────────────────────────────────────────────────────────
const W = 1080, H = 1080;
const coverPath = join(OUT, `${slug}-cover.png`);
const bgCache = join(OUT, `${slug}-bg.png`);

let bg;
if (REUSE_BG && existsSync(bgCache)) bg = readFileSync(bgCache);
else { bg = await sharp(await genBackground("1024x1024")).resize(W, H, { fit: "cover", position: "centre" }).toBuffer(); writeFileSync(bgCache, bg); }

const crest = await heroCrest(W);
const crestSize = Math.round(W * CREST_SIZE);
const crestTop = Math.round(H * 0.25);                 // centred in the image, clear of the title
const crestLeft = Math.round((W - crestSize) / 2);     // dead-centre horizontally
const grain = await grainLayer(W, H);
const overlay = await renderOverlay(W, H);

// art → hero crest → shared grain (ties crest into the art) → text overlay on top
const artWithCrest = await sharp(bg)
  .composite([{ input: crest, top: crestTop, left: crestLeft }])
  .png().toBuffer();
await sharp(artWithCrest)
  .composite([
    { input: grain, blend: "overlay" },
    { input: overlay, top: 0, left: 0 },
  ])
  .png()
  .toFile(coverPath);

console.error(`✓ ${CLUB} → ${coverPath} (${W}×${H}, crest ingrained)`);
console.log(`COVER=${coverPath}`);
