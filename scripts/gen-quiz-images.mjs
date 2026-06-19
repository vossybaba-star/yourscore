/**
 * gen-quiz-images.mjs — make the two daily quiz cards WITHOUT a browser.
 *
 * Hybrid pipeline (so it runs in the cloud / with the Mac off):
 *   1. gpt-image-1 generates the photographic stadium + flag-row art only —
 *      NO text, NO logo, clean negative space upper-left (where the title goes).
 *   2. A deterministic satori→resvg overlay stamps the YourScore logo, the exact
 *      title (final word in mint), and the "WORLD CUP 2026" strip — pixel-perfect,
 *      never drifts.
 *   3. sharp composites the overlay over the art at both sizes:
 *        share  1600×900  (16:9, the X/email link card)
 *        cover  1080×1080 (1:1, the in-app cover)
 *
 * Env: OPENAI_API_KEY. Usage:
 *   node --env-file=.env.local scripts/gen-quiz-images.mjs --quiz <file>.json [--out /tmp] [--quality high|medium|low] [--flags "A,B,C"]
 * Prints two lines: SHARE=<path> and COVER=<path>.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { loadQuiz, titleParts, extractNations, flagPhrase, slugify, ACCENT_HEX } from "./lib/quiz-launch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS = join(__dirname, "assets", "fonts");
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const quizFile = flag("--quiz") || args.find((a) => a.endsWith(".json"));
const OUT = flag("--out") || "/tmp";
const QUALITY = flag("--quality") || "high";
const flagsOverride = flag("--flags");

if (!quizFile) { console.error("Usage: gen-quiz-images.mjs --quiz <file>.json [--out dir] [--quality high|medium|low]"); process.exit(1); }
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

const quiz = loadQuiz(quizFile);
const slug = slugify(quiz.name);
const { title } = titleParts(quiz);
const words = title.split(/\s+/);
const accentWord = words[words.length - 1];
const nations = flagsOverride ? flagsOverride.split(",").map((s) => s.trim()) : extractNations(quiz).map((n) => n.name);
const flagList = (() => {
  const p = nations.map(flagPhrase);
  return p.length > 1 ? `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}` : (p[0] || "the competing nations");
})();

const bebas = readFileSync(join(FONTS, "BebasNeue-Regular.ttf"));
const dmBold = readFileSync(join(FONTS, "DMSans-Bold.ttf"));
const logoDataUri = `data:image/png;base64,${readFileSync(join(ROOT, "public", "logo.png")).toString("base64")}`;

// ── 1. Background art (no text/logo) ─────────────────────────────────────────
// Composition rotates by date so the daily key-art changes each day (not just a
// flag swap on the same crowd shot). Every variant features the golden World Cup
// trophy and the competing nations' flags, and keeps the upper-left third clear
// for the title overlay.
const COMPOSITIONS = [
  `a golden World Cup trophy standing in sharp hero focus on the lower-right, on the centre spot of a floodlit pitch, with a blurred sea of fans waving large national flags — ${flagList} — filling the stands behind it`,
  `the golden World Cup trophy raised aloft amid a roaring crowd on the lower-right, surrounded by large waving national flags — ${flagList} — fireworks and confetti bursting overhead`,
  `a low dramatic hero shot of the golden World Cup trophy on a plinth lower-centre, bathed in warm light, a packed stadium of fans waving national flags — ${flagList} — softly out of focus behind`,
  `the golden World Cup trophy glinting in close detail on the right side, stadium floodlights as bokeh, the colours of national flags — ${flagList} — reflected on its gold surface, jubilant crowd beyond`,
];
function bgPrompt() {
  const key = String(quiz.date || slug).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const scene = COMPOSITIONS[key % COMPOSITIONS.length];
  return `Premium editorial sports key art: ${scene}. Cinematic World Cup tournament atmosphere at dusk under blazing floodlights, confetti and flares hazing in the air. Rich sophisticated grade: deep navy night sky, warm gold glow, saturated flag colours, shallow depth of field. IMPORTANT: absolutely NO text, NO words, NO letters, NO logos, NO watermarks anywhere in the image. Leave the upper-left third as clean, darker negative space (sky / shadow) for a title to be added later — keep the trophy out of the upper-left. Photographic, high-end broadcast key-art look, subtle cinematic grain.`;
}

async function genBackground(size) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: bgPrompt(), size, quality: QUALITY, n: 1 }),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return Buffer.from(j.data[0].b64_json, "base64");
}

// ── 2. Branded overlay (satori → resvg) ──────────────────────────────────────
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });

function overlayTree(W, H) {
  const pad = Math.round(W * 0.045);
  const logoH = Math.round(W * (W > H ? 0.05 : 0.065));
  const subSize = Math.round(W * (W > H ? 0.018 : 0.024));

  // Title auto-sizes by word count so long names ("Goals Records and a Wild
  // Matchday Four") still fit; short ones ("Opening Matchday Verdicts") stay huge.
  const n = words.length;
  const baseRatio = W > H ? 0.108 : 0.135;
  const shrink = n <= 3 ? 1 : n === 4 ? 0.84 : n === 5 ? 0.72 : n === 6 ? 0.62 : 0.54;
  const titleSize = Math.round(W * baseRatio * shrink);
  const titleWidth = Math.round(W * (W > H ? 0.64 : 0.92));

  const titleWords = words.map((w, i) =>
    h("div", { style: { display: "flex", color: i === n - 1 ? ACCENT_HEX : "#ffffff", marginRight: Math.round(titleSize * 0.16) } }, w)
  );

  return h("div", {
    style: {
      width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "flex-start",
      padding: pad, fontFamily: "Bebas Neue",
    },
  },
    h("img", { src: logoDataUri, width: Math.round(logoH * 3.382), height: logoH, style: { marginBottom: Math.round(H * 0.04) } }),
    h("div", { style: { display: "flex", flexWrap: "wrap", width: titleWidth, fontSize: titleSize, lineHeight: 0.9, rowGap: Math.round(titleSize * 0.04) } }, ...titleWords),
    h("div", {
      style: {
        display: "flex", alignItems: "center", marginTop: Math.round(H * 0.022),
        fontFamily: "DM Sans", fontWeight: 700, fontSize: subSize, letterSpacing: subSize * 0.35, color: ACCENT_HEX,
      },
    },
      h("div", { style: { display: "flex", width: Math.round(W * 0.03), height: 3, backgroundColor: ACCENT_HEX, marginRight: subSize * 0.6 } }),
      h("div", { style: { display: "flex" } }, "WORLD CUP 2026")
    )
  );
}

async function renderOverlay(W, H) {
  let svg;
  try {
    svg = await satori(overlayTree(W, H), {
      width: W, height: H,
      fonts: [
        { name: "Bebas Neue", data: bebas, weight: 400, style: "normal" },
        { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
      ],
    });
  } catch (e) { console.error(`\nSATORI ERROR: ${e.message}\n`); process.exit(1); }
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
  return png;
}

// ── 3. Compose ───────────────────────────────────────────────────────────────
const OVERLAY_ONLY = args.includes("--overlay-only"); // debug: skip gpt-image-1, use a dark placeholder
const REUSE_BG = args.includes("--reuse-bg");          // reuse cached AI art (free overlay iteration)

async function makeCard(genSize, W, H, outPath, kind) {
  const bgCache = join(OUT, `${slug}-bg-${kind}.png`);
  let bgResized;
  if (OVERLAY_ONLY) {
    bgResized = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 12, g: 14, b: 22 } } }).png().toBuffer();
  } else if (REUSE_BG && existsSync(bgCache)) {
    bgResized = readFileSync(bgCache);
  } else {
    bgResized = await sharp(await genBackground(genSize)).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
    writeFileSync(bgCache, bgResized); // cache raw art so overlay tweaks don't re-charge
  }
  const overlay = await renderOverlay(W, H);
  await sharp(bgResized).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(outPath);
  return outPath;
}

console.error(`\nGenerating cards for "${quiz.name}" (quality=${QUALITY})`);
console.error(`  flags: ${nations.join(", ")}`);

const sharePath = join(OUT, `${slug}-share.png`);
const coverPath = join(OUT, `${slug}-cover.png`);

await makeCard("1536x1024", 1600, 900, sharePath, "share");   // 16:9 share
console.error(`  ✓ share → ${sharePath}`);
await makeCard("1024x1024", 1080, 1080, coverPath, "cover");  // 1:1 cover
console.error(`  ✓ cover → ${coverPath}`);

console.log(`SHARE=${sharePath}`);
console.log(`COVER=${coverPath}`);
