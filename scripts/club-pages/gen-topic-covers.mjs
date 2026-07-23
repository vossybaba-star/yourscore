/**
 * gen-topic-covers.mjs — the FOUR category covers for club topic quizzes.
 *
 * One artwork per category (History & Honours / Legends / Rivalries / Modern Era), shared by
 * every club. These are CATEGORY cards, not club cards: no crest, no club colour, no club
 * name. All 98 club topic packs point at whichever of the four matches their category, so a
 * new club or a new volume needs no new art at all.
 *
 * Pipeline mirrors scripts/gen-quiz-images.mjs, which is the house standard:
 *   1. gpt-image-1 paints the art only — no text, clean negative space top-left.
 *      Conditioned on scripts/assets/references/ so it matches the established look.
 *   2. A deterministic satori→resvg overlay stamps the category title, so type is
 *      pixel-perfect and never drifts or misspells.
 *   3. sharp composites the two at 1080x1080 (the in-app cover size).
 *
 *   node --env-file=.env.local scripts/club-pages/gen-topic-covers.mjs            # generate 4 + contact sheet
 *   node --env-file=.env.local scripts/club-pages/gen-topic-covers.mjs --category legends
 *   node --env-file=.env.local scripts/club-pages/gen-topic-covers.mjs --upload --i-have-approval
 *
 * Creative assets never ship without a contact-sheet review first — plumbing ships, pixels
 * wait. --upload refuses to run without the explicit approval flag.
 *
 * Env: OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const UPLOAD = args.includes("--upload");
const ONE = args.includes("--category") ? args[args.indexOf("--category") + 1] : null;
const QUALITY = args.includes("--quality") ? args[args.indexOf("--quality") + 1] : "high";
const OUT = "/tmp/topic-covers";

const KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY — run with --env-file=.env.local"); process.exit(1); }

const SIZE = 1080;
const MINT = "#aeea00";
const FONT_DIR = path.join(process.cwd(), "scripts", "assets", "fonts");
const REF_DIR = path.join(process.cwd(), "scripts", "assets", "references");

/**
 * The four categories. `art` describes the SUBJECT only — the house style preamble carries
 * the look, and the title is stamped afterwards, so these prompts never mention text.
 * No club is identifiable in any of them: one card serves all 20.
 */
const CATEGORIES = {
  "history-honours": {
    title: "HISTORY & HONOURS",
    art: "A trophy cabinet as a stadium shrine: a tall silver league trophy centre stage on a plinth, older cups and pennants ranked behind it, dust and shafts of light, a wall of honours boards fading into shadow. Reverent, museum-like, the weight of decades.",
  },
  legends: {
    title: "CLUB LEGENDS",
    art: "The silhouette of a single iconic footballer seen from behind, arms raised to a packed stand, captain's armband, floodlights flaring behind so the outline glows. Anonymous and mythic: no recognisable face, no readable number, no club colours. Statue-like and heroic.",
  },
  "rivalries-derbies": {
    title: "RIVALRIES & DERBIES",
    art: "Derby day: two opposing terraces facing each other across a hard diagonal split down the centre of the frame, scarves held aloft on both sides, smoke and flare light, floodlights above. Tension and noise, two halves of one image, neither side identifiable.",
  },
  "modern-era": {
    title: "THE MODERN ERA",
    art: "A contemporary league night: a sleek modern stadium bowl seen from the touchline, LED perimeter boards streaking with light, sharp floodlight glare, a football on the turf in the foreground. Clean, high-tech, present day.",
  },
};

const STYLE = `Flat vector sports-poster illustration, bold graphic shapes, limited palette of deep black, warm cream, burnt orange and gold, heavy grain and halftone dot texture, high contrast, screen-print feel, dramatic and premium. Square composition. IMPORTANT: absolutely NO text, NO letters, NO numbers, NO logos, NO club badges anywhere in the image. Leave the upper-left third visually calm and uncluttered so a title can be placed there afterwards.`;

function refFiles() {
  if (!fs.existsSync(REF_DIR)) return [];
  return fs.readdirSync(REF_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith("."))
    .sort().slice(0, 3)
    .map((f) => path.join(REF_DIR, f));
}

async function genArt(cat) {
  const subject = CATEGORIES[cat].art;
  const refs = refFiles();
  if (refs.length) {
    const fd = new FormData();
    fd.append("model", "gpt-image-1");
    fd.append("prompt", `Use the attached reference image(s) ONLY as a style guide — match their colour grade, texture, mood and finish — but create a BRAND NEW image with a different composition. ${subject} ${STYLE}`);
    fd.append("size", "1024x1024");
    fd.append("quality", QUALITY);
    fd.append("n", "1");
    fd.append("input_fidelity", "low"); // anchor the STYLE, not a pixel copy
    for (const p of refs) {
      const buf = fs.readFileSync(p);
      const type = /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg";
      fd.append("image[]", new Blob([buf], { type }), path.basename(p));
    }
    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: fd });
    const j = await res.json();
    if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 edits ${res.status}: ${JSON.stringify(j.error || j).slice(0, 260)}`);
    return Buffer.from(j.data[0].b64_json, "base64");
  }
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: `${subject} ${STYLE}`, size: "1024x1024", quality: QUALITY, n: 1 }),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 260)}`);
  return Buffer.from(j.data[0].b64_json, "base64");
}

// ── Title overlay: deterministic, so type never drifts or misspells ────────
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });

async function overlay(title) {
  const fonts = [
    { name: "Bebas Neue", data: fs.readFileSync(path.join(FONT_DIR, "BebasNeue-Regular.ttf")), weight: 400, style: "normal" },
    { name: "DM Sans", data: fs.readFileSync(path.join(FONT_DIR, "DMSans-Bold.ttf")), weight: 700, style: "normal" },
  ];
  const tree = h("div", { style: { display: "flex", flexDirection: "column", width: SIZE, height: SIZE, padding: 52, justifyContent: "flex-start" } },
    h("div", { style: { display: "flex" } },
      h("div", { style: { display: "flex", background: "#000", padding: "10px 22px 18px 22px" } },
        h("div", { style: { display: "flex", fontFamily: "Bebas Neue", fontSize: title.length > 16 ? 72 : 92, color: MINT, letterSpacing: 2, lineHeight: 1 } }, title),
      ),
    ),
    h("div", { style: { display: "flex", marginTop: 12 } },
      h("div", { style: { display: "flex", background: "#000", padding: "9px 18px" } },
        h("div", { style: { display: "flex", fontFamily: "DM Sans", fontWeight: 700, fontSize: 20, color: MINT, letterSpacing: 5 } }, "CLUB QUIZ"),
      ),
    ),
  );
  const svg = await satori(tree, { width: SIZE, height: SIZE, fonts });
  return new Resvg(svg, { fitTo: { mode: "width", value: SIZE }, background: "rgba(0,0,0,0)" }).render().asPng();
}

async function buildCover(cat) {
  const art = await genArt(cat);
  const base = await sharp(art).resize(SIZE, SIZE, { fit: "cover" }).png().toBuffer();
  const ov = await overlay(CATEGORIES[cat].title);
  return sharp(base).composite([{ input: ov, left: 0, top: 0 }]).png().toBuffer();
}

// ── Main ───────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });

if (UPLOAD && !args.includes("--i-have-approval")) {
  console.error("Refusing to upload: generated art needs a contact-sheet review first.");
  console.error("Review /tmp/topic-covers/_contact-sheet.png, get sign-off, then add --i-have-approval.");
  process.exit(1);
}

const cats = ONE ? [ONE] : Object.keys(CATEGORIES);
const made = [];
for (const cat of cats) {
  process.stdout.write(`  ${cat}… `);
  try {
    const png = await buildCover(cat);
    const file = path.join(OUT, `category-${cat}.png`);
    fs.writeFileSync(file, png);
    made.push({ cat, file });
    console.log("ok");
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}

if (made.length > 1) {
  const TILE = 460, COLS = 2;
  const rows = Math.ceil(made.length / COLS);
  const comps = [];
  for (let i = 0; i < made.length; i++) {
    comps.push({ input: await sharp(made[i].file).resize(TILE - 10, TILE - 10).png().toBuffer(), left: (i % COLS) * TILE + 5, top: Math.floor(i / COLS) * TILE + 5 });
  }
  const sheet = path.join(OUT, "_contact-sheet.png");
  await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 4, background: { r: 8, g: 8, b: 8, alpha: 1 } } }).composite(comps).png().toFile(sheet);
  console.log(`\nContact sheet: ${sheet}`);
}

if (!UPLOAD) {
  console.log("\nNothing uploaded. Review the contact sheet, then re-run with --upload --i-have-approval.");
  process.exit(0);
}

// ── Upload, and point every pack of that category at its cover ─────────────
const db = createClient(SUPABASE_URL, SERVICE_KEY);
for (const { cat, file } of made) {
  const objectName = `category-${cat}-cover.png`;
  const { error: upErr } = await db.storage.from("quiz-share").upload(objectName, fs.readFileSync(file), { contentType: "image/png", upsert: true });
  if (upErr) { console.error(`upload failed ${objectName}: ${upErr.message}`); continue; }
  const url = `${SUPABASE_URL}/storage/v1/object/public/quiz-share/${objectName}?v=${Date.now()}`;

  const { data: packs } = await db.from("quiz_packs").select("id, metadata").eq("metadata->>club_topic", cat);
  let n = 0;
  for (const p of packs ?? []) {
    const { error } = await db.from("quiz_packs").update({ metadata: { ...(p.metadata ?? {}), cover_image: url } }).eq("id", p.id);
    if (!error) n++;
  }
  console.log(`${cat}: uploaded, ${n} pack(s) now point at it`);
}
