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

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { loadQuiz, titleParts, extractNations, flagPhrase, slugify, ACCENT_HEX } from "./lib/quiz-launch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS = join(__dirname, "assets", "fonts");
const REF_DIR = join(__dirname, "assets", "references");
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const quizFile = flag("--quiz") || args.find((a) => a.endsWith(".json"));
const OUT = flag("--out") || "/tmp";
const QUALITY = flag("--quality") || "high";
const flagsOverride = flag("--flags");
const NO_REF = args.includes("--no-ref"); // force plain text-to-image, ignore the reference set

// Curated style references — a few of the founder's best prior cards live in
// scripts/assets/references/. When present we condition gpt-image-1 on them (via the
// /images/edits endpoint) so every day's art matches that established look WITHOUT a
// browser. Drop in text-free background art (see that folder's README). No refs → we fall
// back to plain text-to-image, so the script always works.
function refFiles() {
  if (NO_REF || !existsSync(REF_DIR)) return [];
  return readdirSync(REF_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith("."))
    .sort()
    .slice(0, 4) // keep the payload tight; 1–3 strong refs beat many
    .map((f) => join(REF_DIR, f));
}

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
// STYLE SYSTEM (founder-locked, Jul 7): the old look — the same gold-trophy-and-
// flags photo every day — read as samey. Now the art style itself rotates:
//   S2 retro matchday poster  = the BASE (flat vintage-programme illustration)
//   S4 fan's-eye terraces     = in rotation for the fan feel
//   S1 cinematic story        = reserved for big moments
//   S3 comic / ink action     = reserved for big moments
// Day-to-day alternates S2/S4 by date; each "Regenerate" press on the Telegram
// gate advances the rotation (S2 → S4 → S1 → S3), so big-moment styles are one
// tap away with no laptop. `--style 1|2|3|4` forces one explicitly.
const NO_TEXT = `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO badges, NO watermarks anywhere in the image. Keep the upper-left third as calmer, darker negative space for a title to be added later.`;

// Poster palettes rotate by date so each day owns a different colour world.
const POSTER_PALETTES = [
  "deep pitch green, rich gold and off-white cream",
  "midnight navy, warm gold and cream",
  "deep claret, gold and cream",
  "royal blue, warm yellow and cream",
  "near-black, rich gold and cream with one red accent",
  "deep bottle green, off-white and one sky-blue accent",
];

const STYLE_PROMPTS = {
  1: () => `Cinematic photographic sports key art: the golden World Cup trophy amid a roaring floodlit stadium, large national flags — ${flagList} — waving through gold confetti haze. Deep navy night, warm gold glow, shallow depth of field, broadcast key-art finish, subtle cinematic grain. ${NO_TEXT}`,
  2: (key) => `Flat graphic illustration in vintage football matchday-poster style: bold simplified geometric shapes, screen-print texture, limited palette of ${POSTER_PALETTES[key % POSTER_PALETTES.length]}. The golden World Cup trophy as a bold central motif with clean geometric floodlight rays, stylised abstract pennants in the colours of ${flagList}, halftone crowd texture below. Mid-century poster composition, thick shapes, no gradients. ${NO_TEXT}`,
  3: () => `Dramatic graphic-novel comic panel: an explosive World Cup action moment — a full-stretch save, a thumping volley — drawn with bold black ink outlines, dynamic low camera angle, speed lines, halftone dot shading, deep green and gold limited comic palette with white highlights, flags of ${flagList} rippling in the inked crowd. ${NO_TEXT}`,
  4: () => `Photographic shot from INSIDE a football crowd at night: fans' backs and raised scarves silhouetted in the foreground, flags of ${flagList} held high among them, a flare glowing, the distant floodlit World Cup pitch far below. Emotional documentary feel, deep navy night, warm gold floodlight haze, shallow depth of field, cinematic grain. ${NO_TEXT}`,
};

// Rotation: base S2/S4 alternating by date; each regenerate (--alt) steps
// through [today's base, the other base, S1, S3].
const STYLE_FLAG = Number.parseInt(flag("--style") ?? "", 10);
const ALT = Number.parseInt(flag("--alt") ?? "0", 10) || 0;
const dateKey = String(quiz.date || slug).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
function pickStyle() {
  if ([1, 2, 3, 4].includes(STYLE_FLAG)) return STYLE_FLAG;
  const base = dateKey % 2 === 0 ? 2 : 4;
  const order = [base, base === 2 ? 4 : 2, 1, 3];
  return order[ALT % order.length];
}
const STYLE = pickStyle();

function bgPrompt() {
  return STYLE_PROMPTS[STYLE](dateKey);
}

// Style-match preamble used only when we have reference art: keep gpt-image-1 anchored to
// the reference look/grade but free to invent a NEW composition (low input_fidelity = creative).
// ONLY for the cinematic style — the reference set is the old photographic look and would
// drag the poster/comic/terraces styles straight back to it.
function bgPromptWithRef() {
  return `Use the attached reference image(s) ONLY as a style guide — match their colour grade, lighting, mood and premium editorial finish — but create a BRAND NEW image with a different composition. ${bgPrompt()}`;
}

async function genBackground(size) {
  // Reference art is the OLD photographic look — it only conditions the
  // cinematic style (S1); the other styles must be free of it or they regress.
  const refs = STYLE === 1 ? refFiles() : [];

  if (refs.length) {
    // Reference-conditioned: /images/edits with gpt-image-1 + the curated style refs.
    const fd = new FormData();
    fd.append("model", "gpt-image-1");
    fd.append("prompt", bgPromptWithRef());
    fd.append("size", size);
    fd.append("quality", QUALITY);
    fd.append("n", "1");
    fd.append("input_fidelity", "low"); // anchor the STYLE, not a pixel copy → new composition
    for (const p of refs) {
      const buf = readFileSync(p);
      const type = /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg";
      fd.append("image[]", new Blob([buf], { type }), p.split("/").pop());
    }
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: fd,
    });
    const j = await res.json();
    if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 edits ${res.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
    return Buffer.from(j.data[0].b64_json, "base64");
  }

  // Fallback: plain text-to-image (no reference set yet).
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

  // Poster/comic art (S2/S3) can be bright at the top no matter what the
  // prompt asks — a soft dark scrim under the text keeps the title readable.
  // The photographic styles keep their naturally dark skies, no scrim.
  const scrim = STYLE === 2 || STYLE === 3
    ? [h("div", { style: { display: "flex", position: "absolute", top: 0, left: 0, width: W, height: Math.round(H * 0.46), background: "linear-gradient(180deg, rgba(5,10,8,0.72) 0%, rgba(5,10,8,0.4) 62%, rgba(5,10,8,0) 100%)" } })]
    : [];

  return h("div", {
    style: {
      width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "flex-start",
      padding: pad, fontFamily: "Bebas Neue", position: "relative",
    },
  },
    ...scrim,
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

const _refs = STYLE === 1 ? refFiles() : [];
const STYLE_NAMES = { 1: "cinematic story", 2: "retro matchday poster", 3: "comic ink", 4: "fan's-eye terraces" };
console.error(`\nGenerating cards for "${quiz.name}" (quality=${QUALITY})`);
console.error(`  flags: ${nations.join(", ")}`);
console.error(`  style: S${STYLE} ${STYLE_NAMES[STYLE]}${ALT ? ` (regen step ${ALT})` : ""}${_refs.length ? ` + refs (${_refs.map((r) => r.split("/").pop()).join(", ")})` : ""}`);

const sharePath = join(OUT, `${slug}-share.png`);
const coverPath = join(OUT, `${slug}-cover.png`);

await makeCard("1536x1024", 1600, 900, sharePath, "share");   // 16:9 share
console.error(`  ✓ share → ${sharePath}`);
await makeCard("1024x1024", 1080, 1080, coverPath, "cover");  // 1:1 cover
console.error(`  ✓ cover → ${coverPath}`);

console.log(`SHARE=${sharePath}`);
console.log(`COVER=${coverPath}`);
