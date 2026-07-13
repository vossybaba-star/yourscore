/**
 * gen-gametype-cover.mjs — cover art for the Quiz "game types" (Higher or Lower,
 * Guess the Player) using the SAME method as the daily quiz covers
 * (gen-quiz-images.mjs): gpt-image-1 makes the retro matchday-poster background
 * (no text, football-only, negative space upper-left), then a satori→resvg overlay
 * stamps the YourScore logo + title on a black plate + a "YourScore" strip, and
 * sharp composites a 1080×1080 cover.
 *
 * Difference from the daily pipeline: the MOTIF is the game concept (not the WC
 * trophy + flags) and the strip reads "YourScore" (not "WORLD CUP 2026").
 *
 * Env: OPENAI_API_KEY (ChatGPT / gpt-image-1). Usage:
 *   node --env-file=.env.local scripts/gen-gametype-cover.mjs --type higher-lower --n 3 --out DIR [--quality high]
 * Writes <slug>-cover-<i>.png for each variant and prints their paths.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ACCENT_HEX } from "./lib/quiz-launch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS = join(__dirname, "assets", "fonts");
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const TYPE = flag("--type");
const N = Number.parseInt(flag("--n") ?? "3", 10) || 3;
const OUT = flag("--out") || "/tmp";
const QUALITY = flag("--quality") || "high";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

// Football-only + no-text guard (verbatim from gen-quiz-images.mjs) + reserve
// the upper-left for the stamped title.
const NO_TEXT = `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO badges, NO watermarks anywhere in the image. Keep the upper-left third as calmer, darker negative space for a title to be added later. This is ASSOCIATION FOOTBALL (soccer) ONLY: any ball must be a round soccer ball with classic panels — NEVER an American football, NO egg-shaped balls, NO gridiron, NO helmets, NO shoulder pads.`;

// Retro matchday-poster base (S2 style, verbatim framing) + a game-specific motif.
const posterPrompt = (palette, motif) =>
  `Flat graphic illustration in vintage football matchday-poster style: bold simplified geometric shapes, screen-print texture, limited palette of ${palette}. ${motif} Mid-century poster composition, thick shapes, no gradients, halftone crowd texture below. ${NO_TEXT}`;

const GAME = {
  "higher-lower": {
    slug: "higher-lower",
    title: "HIGHER OR LOWER",
    palette: "deep pitch green, rich gold and off-white cream",
    motif:
      "Central motif on a stylised floodlit football pitch: two tall vertical podium bars of clearly different heights standing side by side — one bar much TALLER than the other — with a big bold upward chevron arrow above the taller bar and a downward chevron arrow above the shorter bar; a single classic round soccer ball resting at the base between them; clean geometric floodlight rays fanning out behind.",
  },
  "guess-the-player": {
    slug: "guess-the-player",
    title: "GUESS THE PLAYER",
    palette: "midnight navy, warm gold and cream",
    motif:
      "Central motif: one mysterious footballer rendered as a single bold solid silhouette bust (head and shoulders), lit dramatically from above by a geometric spotlight beam, with a large bold question-mark shape sitting over the silhouette; a single classic round soccer ball at the base; geometric spotlight rays.",
  },
};

const cfg = GAME[TYPE];
if (!cfg) { console.error(`--type must be one of: ${Object.keys(GAME).join(", ")}`); process.exit(1); }

const bebas = readFileSync(join(FONTS, "BebasNeue-Regular.ttf"));
const dmBold = readFileSync(join(FONTS, "DMSans-Bold.ttf"));
const logoDataUri = `data:image/png;base64,${readFileSync(join(ROOT, "public", "logo.png")).toString("base64")}`;

// ── overlay (adapted from gen-quiz-images.mjs; strip = "YourScore") ───────────
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });

function overlayTree(W, H, title, strip) {
  const words = title.split(/\s+/);
  const n = words.length;
  const pad = Math.round(W * 0.045);
  const logoH = Math.round(W * 0.065);
  const subSize = Math.round(W * 0.024);
  const shrink = n <= 3 ? 1 : n === 4 ? 0.84 : 0.72;
  const titleSize = Math.round(W * 0.135 * shrink);
  const titleWidth = Math.round(W * 0.92);

  const titleWords = words.map((w, i) =>
    h("div", { style: { display: "flex", color: i === n - 1 ? ACCENT_HEX : "#ffffff",
      backgroundColor: "rgba(6,8,7,0.92)",
      paddingTop: Math.round(titleSize * 0.05), paddingBottom: Math.round(titleSize * 0.07),
      paddingLeft: Math.round(titleSize * 0.12), paddingRight: Math.round(titleSize * 0.12),
      marginRight: Math.round(titleSize * 0.07) } }, w));

  return h("div", {
    style: { width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "flex-start",
      padding: pad, fontFamily: "Bebas Neue", position: "relative" },
  },
    h("img", { src: logoDataUri, width: Math.round(logoH * 3.382), height: logoH, style: { marginBottom: Math.round(H * 0.04) } }),
    h("div", { style: { display: "flex", flexWrap: "wrap", width: titleWidth, fontSize: titleSize, lineHeight: 0.9, rowGap: Math.round(titleSize * 0.04) } }, ...titleWords),
    h("div", {
      style: { display: "flex", alignItems: "center", alignSelf: "flex-start", marginTop: Math.round(H * 0.022),
        fontFamily: "DM Sans", fontWeight: 700, fontSize: subSize, letterSpacing: subSize * 0.35, color: ACCENT_HEX,
        backgroundColor: "rgba(6,8,7,0.92)",
        paddingTop: Math.round(subSize * 0.35), paddingBottom: Math.round(subSize * 0.35),
        paddingLeft: Math.round(subSize * 0.55), paddingRight: Math.round(subSize * 0.55) },
    },
      h("div", { style: { display: "flex", width: Math.round(W * 0.03), height: 3, backgroundColor: ACCENT_HEX, marginRight: subSize * 0.6 } }),
      h("div", { style: { display: "flex" } }, strip)
    )
  );
}

async function renderOverlay(W, H, title, strip) {
  const svg = await satori(overlayTree(W, H, title, strip), {
    width: W, height: H,
    fonts: [
      { name: "Bebas Neue", data: bebas, weight: 400, style: "normal" },
      { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
}

// ── gpt-image-1 background (ChatGPT) ─────────────────────────────────────────
const PLACEHOLDER = args.includes("--placeholder"); // skip the API: overlay-only proof
async function genBackground() {
  if (PLACEHOLDER) {
    const bg = { "higher-lower": { r: 12, g: 40, b: 30 }, "guess-the-player": { r: 14, g: 20, b: 40 } }[TYPE];
    return Promise.all(
      Array.from({ length: N }, () =>
        sharp({ create: { width: 1024, height: 1024, channels: 3, background: bg } }).png().toBuffer()),
    );
  }
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: posterPrompt(cfg.palette, cfg.motif), size: "1024x1024", quality: QUALITY, n: N }),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.length) throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return j.data.map((d) => Buffer.from(d.b64_json, "base64"));
}

mkdirSync(OUT, { recursive: true });
console.error(`\nGenerating ${N} "${cfg.title}" covers via gpt-image-1 (ChatGPT, quality=${QUALITY})…`);
const backgrounds = await genBackground();
const W = 1080, H = 1080;
const overlay = await renderOverlay(W, H, cfg.title, "YourScore");
const paths = [];
for (let i = 0; i < backgrounds.length; i++) {
  const bg = await sharp(backgrounds[i]).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const out = join(OUT, `${cfg.slug}-cover-${i + 1}.png`);
  await sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(out);
  paths.push(out);
  console.error(`  ✓ ${out}`);
}
console.log(paths.join("\n"));
