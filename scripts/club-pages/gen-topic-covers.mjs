/**
 * gen-topic-covers.mjs — cover art for the club TOPIC packs, built deterministically.
 *
 * The 98 club topic packs (History & Honours / Legends / Modern Era / Rivalries, plus their
 * volumes) ship with no cover, so the club page falls back to an emoji. The 20 club SEASON
 * packs already have hand-made poster art, and this matches that language: flat vector,
 * club-coloured sunburst, floodlights, stadium silhouette, crowd dots, grain, crest centred,
 * title top-left over a black bar with a labelled strip underneath.
 *
 * Reusable per club, which is the whole point: ONE artwork per club x topic is generated from
 * parameters (crest + club colour + topic), so a new club or a new volume costs nothing and
 * every card stays consistent. Volumes share their topic's art — a volume is the same subject,
 * not a different one.
 *
 * NO image model is used. The house look is flat vector, so it is drawn as SVG and rasterised.
 * That means zero API cost, zero generation variance, and instant regeneration. The club colour
 * is sampled from the crest itself, so nothing is hardcoded per club.
 *
 *   node --env-file=.env.local scripts/club-pages/gen-topic-covers.mjs --contact-sheet
 *       → renders a review grid to /tmp and writes NOTHING. Start here.
 *   node --env-file=.env.local scripts/club-pages/gen-topic-covers.mjs --club Arsenal
 *       → renders one club's four topics to /tmp for a closer look.
 *   node --env-file=.env.local scripts/club-pages/gen-topic-covers.mjs --upload
 *       → uploads to the quiz-share bucket and sets metadata.cover_image. FOUNDER APPROVAL ONLY.
 *
 * Creative assets are never shipped without a contact-sheet review first — plumbing ships,
 * pixels wait.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const CONTACT = args.includes("--contact-sheet");
const UPLOAD = args.includes("--upload");
const ONE_CLUB = args.includes("--club") ? args[args.indexOf("--club") + 1] : null;
const OUT = "/tmp/topic-covers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env — run with --env-file=.env.local"); process.exit(1); }
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const SIZE = 1080;
const MINT = "#aeea00";
const FONT_DIR = path.join(process.cwd(), "scripts", "assets", "fonts");

const TOPICS = {
  "history-honours": { label: "History & Honours", strip: "HISTORY & HONOURS" },
  legends: { label: "Legends", strip: "CLUB LEGENDS" },
  "modern-era": { label: "Modern Era", strip: "THE MODERN ERA" },
  "rivalries-derbies": { label: "Rivalries", strip: "RIVALRIES & DERBIES" },
};

// ── Club colour, sampled from the crest ────────────────────────────────────
/**
 * sharp's `dominant` is useless here: it returned the SAME muted red for Arsenal, Chelsea,
 * Wolves, Everton and Newcastle, because the modal bucket on a crest is the dark outline,
 * not the club colour. The contact sheet caught it — six clubs, one colour.
 *
 * Instead: walk the raw pixels, throw away anything transparent, near-grey, near-black or
 * near-white (outlines, text, white fields), bucket the remaining HUES weighted by
 * saturation, and take the modal bucket. That is the club's actual colour, and it works for
 * any crest without a hardcoded palette.
 */
async function clubColour(crestBuf) {
  const { data, info } = await sharp(crestBuf).resize(160, 160, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const BUCKETS = 36;
  const weight = new Array(BUCKETS).fill(0);
  const satSum = new Array(BUCKETS).fill(0);
  const litSum = new Array(BUCKETS).fill(0);
  for (let i = 0; i < data.length; i += ch) {
    const a = ch === 4 ? data[i + 3] : 255;
    if (a < 200) continue; // transparent crest background
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (l < 0.12 || l > 0.92) continue;      // outline black / white field
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (sat < 0.35) continue;                 // grey, silver, off-white
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    const bIdx = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
    weight[bIdx] += sat;
    satSum[bIdx] += sat;
    litSum[bIdx] += l;
  }
  let best = -1, bestW = 0, count = 0;
  for (let i = 0; i < BUCKETS; i++) { if (weight[i] > bestW) { bestW = weight[i]; best = i; } count += weight[i]; }
  // A crest with no saturated colour at all (pure black/white, e.g. some monochrome marks):
  // fall back to a warm red rather than rendering a grey card.
  if (best < 0 || count === 0) return "rgb(196,54,46)";
  const h = best * (360 / BUCKETS) + (360 / BUCKETS) / 2;
  // Force a consistent, poster-grade saturation/lightness so every club reads equally strong.
  const s = 0.74, lightness = 0.47;
  const c = (1 - Math.abs(2 * lightness - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  const to = (v) => Math.round((v + m) * 255);
  return `rgb(${to(seg[0])},${to(seg[1])},${to(seg[2])})`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The poster, as SVG. Flat vector so it rasterises identically every time. */
function posterSvg({ club, strip, colour }) {
  const cx = SIZE / 2, cy = SIZE / 2 + 40;
  // Sunburst
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a0 = (i * 15 - 90) * (Math.PI / 180), a1 = ((i * 15) + 7 - 90) * (Math.PI / 180);
    const R = SIZE * 1.1;
    return `<path d="M${cx},${cy} L${cx + Math.cos(a0) * R},${cy + Math.sin(a0) * R} L${cx + Math.cos(a1) * R},${cy + Math.sin(a1) * R} Z" fill="${colour}" opacity="${i % 2 ? 0.30 : 0.52}"/>`;
  }).join("");
  // Crowd dots
  const dots = Array.from({ length: 320 }, (_, i) => {
    const row = Math.floor(i / 80); const x = (i % 80) * 13.5 + (row % 2 ? 7 : 0);
    const y = SIZE - 104 + row * 24;
    return `<circle cx="${x}" cy="${y}" r="4.2" fill="${colour}" opacity="0.5"/>`;
  }).join("");
  const floodlight = (x, flip) => `
    <g transform="translate(${x},250) ${flip ? `scale(-1,1)` : ""}">
      <rect x="-8" y="60" width="16" height="330" fill="#0d0d0d"/>
      <rect x="-62" y="-6" width="124" height="86" rx="8" fill="#0d0d0d"/>
      ${Array.from({ length: 12 }, (_, i) => `<circle cx="${-46 + (i % 4) * 31}" cy="${14 + Math.floor(i / 4) * 26}" r="10" fill="#e8c66a" opacity="0.9"/>`).join("")}
    </g>`;
  const clubUpper = esc(club.toUpperCase());
  const titleSize = clubUpper.length > 16 ? 62 : clubUpper.length > 12 ? 76 : 92;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#0b0b0b"/>
  ${rays}
  ${floodlight(118, false)}
  ${floodlight(SIZE - 118, true)}
  <path d="M0,${SIZE - 150} Q${cx},${SIZE - 265} ${SIZE},${SIZE - 150} L${SIZE},${SIZE} L0,${SIZE} Z" fill="#0d0d0d"/>
  ${dots}
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#vig)"/>
  <defs>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect x="44" y="52" width="${Math.min(SIZE - 88, clubUpper.length * titleSize * 0.62 + 44)}" height="${titleSize + 26}" fill="#000"/>
  <text x="66" y="${52 + titleSize + 2}" font-family="Bebas Neue" font-size="${titleSize}" fill="${MINT}" letter-spacing="2">${clubUpper}</text>
  <rect x="44" y="${52 + titleSize + 40}" width="${esc(strip).length * 15 + 62}" height="42" fill="#000"/>
  <text x="66" y="${52 + titleSize + 70}" font-family="DM Sans" font-weight="700" font-size="21" fill="${MINT}" letter-spacing="4">— ${esc(strip)}</text>
</svg>`;
}

async function renderCover({ club, topicSlug, crestBuf }) {
  const colour = await clubColour(crestBuf);
  const svg = posterSvg({ club, strip: TOPICS[topicSlug].strip, colour });
  const base = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    font: { fontDirs: [FONT_DIR], loadSystemFonts: false, defaultFontFamily: "DM Sans" },
  }).render().asPng();

  // Crest, centred and generously sized — it is the subject of the card.
  const crest = await sharp(crestBuf).resize(430, 430, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const meta = await sharp(crest).metadata();
  return sharp(base)
    .composite([{ input: crest, left: Math.round((SIZE - (meta.width ?? 430)) / 2), top: Math.round(SIZE / 2 + 40 - (meta.height ?? 430) / 2) }])
    .png()
    .toBuffer();
}

/**
 * Crests are LOCAL files (public/badges/{slug}.png), per src/lib/teamImages.ts — not a bucket.
 * Reading them off disk keeps this script offline-capable and guarantees the same crest the
 * app renders. No remote fallback: a wrong image is worse than a skipped club (the first pass
 * fell through to the season cover and composited an entire poster as the "crest").
 */
function crestFor(club) {
  const slug = club.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = path.join(process.cwd(), "public", "badges", `${slug}.png`);
  if (!fs.existsSync(file)) return null;
  return { buf: fs.readFileSync(file), from: file };
}

async function inRotationClubs() {
  const { data, error } = await db.from("quiz_packs").select("name")
    .eq("type", "club").eq("status", "published").eq("rotation_active", true).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.name);
}

// ── Main ───────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const clubs = ONE_CLUB ? [ONE_CLUB] : await inRotationClubs();

if (UPLOAD) {
  console.error("Refusing to upload: generated art needs a contact-sheet review first.");
  console.error("Run --contact-sheet, get sign-off, then re-run with --upload --i-have-approval");
  if (!args.includes("--i-have-approval")) process.exit(1);
}

const sheetTiles = [];
// Deliberately colour-diverse for review: red, blue, gold, black/white, claret, navy.
// Alphabetical order would show six near-identical reds and prove nothing.
const REVIEW_SET = ["Arsenal", "Chelsea", "Wolverhampton Wanderers", "Newcastle United", "Aston Villa", "Everton"];
const picked = ONE_CLUB ? clubs : REVIEW_SET.filter((c) => clubs.includes(c));
for (const club of picked) {
  const crest = crestFor(club);
  if (!crest) { console.log(`  no crest for ${club} — skipped`); continue; }
  for (const slug of Object.keys(TOPICS)) {
    const png = await renderCover({ club, topicSlug: slug, crestBuf: crest.buf });
    const file = path.join(OUT, `${club.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${slug}.png`);
    fs.writeFileSync(file, png);
    sheetTiles.push({ file, club, slug });
    console.log(`  ${path.basename(file)}`);
  }
}

if (CONTACT || !ONE_CLUB) {
  const COLS = 4, TILE = 300;
  const rows = Math.ceil(sheetTiles.length / COLS);
  const sheet = sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 4, background: { r: 8, g: 8, b: 8, alpha: 1 } } });
  const comps = [];
  for (let i = 0; i < sheetTiles.length; i++) {
    comps.push({
      input: await sharp(sheetTiles[i].file).resize(TILE - 8, TILE - 8).png().toBuffer(),
      left: (i % COLS) * TILE + 4, top: Math.floor(i / COLS) * TILE + 4,
    });
  }
  const sheetPath = path.join(OUT, "_contact-sheet.png");
  await sheet.composite(comps).png().toFile(sheetPath);
  console.log(`\nContact sheet: ${sheetPath}  (${sheetTiles.length} covers)`);
}

console.log("\nNothing uploaded. Review the contact sheet first.");
