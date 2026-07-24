/**
 * gen-avatars.mjs — the YourScore avatar set: illustrated football-fan portraits.
 *
 * Why this exists: hand-built SVG faces have a hard quality ceiling, and a set of
 * separately-generated AI portraits normally looks like 12 different products.
 * This borrows the fix already proven in gen-quiz-images.mjs — generate ONE
 * anchor, then condition every sibling on it via /images/edits with a low
 * input_fidelity, so the style is inherited while the person is new.
 *
 * Output is a contact sheet for review. Nothing here ships to users: the founder
 * picks the keepers, and only those get regenerated at full quality.
 *
 * Env: OPENAI_API_KEY (in .env.local).
 *
 *   node --env-file=.env.local scripts/gen-avatars.mjs --dry-run
 *   node --env-file=.env.local scripts/gen-avatars.mjs --count 16
 *   node --env-file=.env.local scripts/gen-avatars.mjs --only 3,7,11 --quality high
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "avatars");
const WORK_DIR = join(__dirname, "assets", "avatar-work");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry-run");
const QUALITY = flag("--quality") || "medium";
const COUNT = Number.parseInt(flag("--count") ?? "16", 10);
const ONLY = (flag("--only") ?? "").split(",").map((s) => Number.parseInt(s.trim(), 10)).filter(Number.isFinite);

// ── The style lock ──────────────────────────────────────────────────────────
// This paragraph is the ONLY thing every avatar shares, and it is what makes
// them a set. Change it and you must regenerate all of them, including the
// anchor — a half-updated set reads as broken.
//
// Founder direction (Jul 21): "classy and slick, colourful, not too cheesy" and
// then, decisively: NOT real people — "like game characters… silhouettes of
// footballers, footballers playing the game, kicking a ball / managers."
//
// So this is a character-select screen, not a portrait gallery. A bold silhouette
// is also the right engineering answer: shape reads at 24px in a leaderboard row
// where a face turns to mush.
const STYLE = [
  "Bold graphic sports-game character art — the kind used on a video game character-select screen.",
  "A single dramatic FOOTBALLER SILHOUETTE: the figure is rendered as a solid near-black shape with crisp readable edges, lit from behind and edged by a bright ACCENT-COLOURED rim light that separates it from the background.",
  "Dynamic athletic action pose, full of movement and power, captured mid-motion.",
  "The background is VERY DARK — a deep near-black with a subtle cool dark-green cast — carrying a soft radial glow of the accent colour behind the figure, fine grain texture and a strong vignette.",
  "The accent colour is the ONLY colour in the image: it appears in the rim light and the glow, never as a flat filled background. Keep the overall image dark and moody; the figure must still read as a clear black silhouette.",
  "Slick, premium and energetic — NOT cartoonish, NOT caricature, NOT cutesy, NOT chibi, no goofy faces. Faces are not detailed; the SHAPE tells the story.",
  "Composed as a circular medallion: the whole figure sits centred and complete well inside the frame with even margin, designed to be cropped into a CIRCLE without clipping limbs.",
].join(" ");

// Hard constraints. The IP line matters: real club crests and kits are not ours
// to redraw, and an avatar is a permanent, shipped asset.
const CONSTRAINTS = [
  "Square 1:1 composition.",
  "IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO club badges, NO crests, NO real-world team kits or sponsor marks, NO watermarks, NO shirt numbers.",
  "Kit must be a plain INVENTED generic colour combination, never a real club's identity, and must not resemble any recognisable real player.",
  "One figure only. No background crowds, no stadium architecture, no scoreboard.",
].join(" ");

/**
 * The cast is a set of ROLES AND MOMENTS, not a set of people — you pick the
 * player you are, the way you'd pick a character in a game. Each entry is chosen
 * for a distinct SILHOUETTE: a volley, a dive and a knee-slide must be tellable
 * apart as pure shape in a 24px circle, which is the real design constraint.
 */
const CAST = [
  { id: "01", label: "Volley",     who: "a footballer striking a spectacular mid-air volley, body sideways, striking leg fully extended, arms out for balance", bg: "lime" },
  { id: "02", label: "Keeper",     who: "a goalkeeper at full stretch in a horizontal flying dive, both arms reaching for the ball, gloves spread", bg: "teal" },
  // NOT a player. The first run quietly turned this into another kicking figure
  // — the style anchor overpowered the pose — so the negative is stated outright.
  { id: "03", label: "Manager",    who: "a football MANAGER standing still on the touchline, NOT a player: a full-length figure in a long knee-length overcoat and smart trousers, arms folded across the chest, feet planted on the ground, watching intently. There is NO BALL anywhere in the image and the figure is NOT kicking, NOT running and NOT jumping", bg: "teal" },
  { id: "04", label: "Header",     who: "a footballer leaping high for a header, neck arched back, both arms spread wide for balance", bg: "lime" },
  { id: "05", label: "Knee slide", who: "a footballer celebrating with a knee slide, both arms flung out wide behind, head thrown back in joy", bg: "gold" },
  { id: "06", label: "Sprint",     who: "a winger sprinting at full pace with the ball at their feet, body leaning forward, arms driving", bg: "lime" },
  { id: "07", label: "Tackle",     who: "a defender fully committed to a sliding tackle, one leg extended low, turf spraying", bg: "lime" },
  { id: "08", label: "Free kick",  who: "a footballer standing over a dead ball preparing a free kick, hands on hips, chin down, utterly still", bg: "teal" },
  { id: "09", label: "Bicycle",    who: "a footballer executing an overhead bicycle kick, fully inverted in mid-air, both legs scissoring", bg: "lime" },
  { id: "10", label: "Punch",      who: "a goalkeeper rising above a crowd to punch the ball clear, one fist driven upward", bg: "teal" },
  { id: "11", label: "Captain",    who: "a captain standing tall with both arms raised in triumph, captain's armband visible on the upper arm", bg: "gold" },
  { id: "12", label: "Trophy",     who: "a footballer lifting a trophy high overhead with both hands, back arched in celebration", bg: "gold" },
  { id: "13", label: "Playmaker",  who: "a midfielder mid-pass, planted foot down and passing leg following through across the body, head up", bg: "lime" },
  { id: "14", label: "Nutmeg",     who: "a skilful attacker dropping a shoulder into a dramatic step-over feint, hips twisted, ball at the feet", bg: "lime" },
  { id: "15", label: "Roar",       who: "a footballer roaring in celebration, both fists clenched and pulled down hard to the sides, chest out", bg: "gold" },
  { id: "16", label: "Chip",       who: "a striker delicately chipping the ball, toe under it, body upright and balanced, arms relaxed", bg: "lime" },
];

// The three brand accents, and nothing else. Named with their hex so the model
// aims at the actual YourScore palette rather than a generic "green" or "gold".
const ACCENTS = {
  lime: "bright lime green (#aeea00)",
  teal: "bright aqua teal (#00d8c0)",
  gold: "warm gold (#ffc233)",
};

function promptFor(c) {
  return `${STYLE} The scene shows ${c.who}. The accent colour is ${ACCENTS[c.bg]}. ${CONSTRAINTS}`;
}

/** The anchor establishes the look; everything else inherits it. */
function anchorPrompt(c) {
  return promptFor(c);
}

function siblingPrompt(c) {
  return [
    "Use the attached reference image ONLY as a style guide — match its illustration style,",
    "silhouette treatment, rim lighting, colour treatment, grain and circular framing EXACTLY —",
    "but draw a COMPLETELY DIFFERENT ACTION POSE. Do not repeat the reference's pose.",
    promptFor(c),
  ].join(" ");
}

const KEY = process.env.OPENAI_API_KEY;

async function textToImage(prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality: QUALITY, n: 1 }),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.b64_json) {
    throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  }
  return Buffer.from(j.data[0].b64_json, "base64");
}

async function editFromRef(prompt, refBuf) {
  const fd = new FormData();
  fd.append("model", "gpt-image-1");
  fd.append("prompt", prompt);
  fd.append("size", "1024x1024");
  fd.append("quality", QUALITY);
  fd.append("n", "1");
  // Low fidelity anchors the STYLE without copying the face — the same setting
  // the quiz-cover pipeline relies on to get a new composition each day.
  fd.append("input_fidelity", "low");
  fd.append("image[]", new Blob([refBuf], { type: "image/png" }), "anchor.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: fd,
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.b64_json) {
    throw new Error(`gpt-image-1 edits ${res.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  }
  return Buffer.from(j.data[0].b64_json, "base64");
}

/** Circle-cropped 512px WebP — how it will actually be seen. */
async function toAvatar(buf, outPath) {
  const S = 512;
  const mask = Buffer.from(
    `<svg width="${S}" height="${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="#fff"/></svg>`
  );
  await sharp(buf)
    .resize(S, S, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .webp({ quality: 90 })
    .toFile(outPath);
}

async function contactSheet(files, outPath) {
  const CELL = 200, COLS = 8, PAD = 12;
  const rows = Math.ceil(files.length / COLS);
  const W = COLS * (CELL + PAD) + PAD;
  const H = rows * (CELL + PAD) + PAD;
  const tiles = await Promise.all(
    files.map(async (f, i) => ({
      input: await sharp(f).resize(CELL, CELL).png().toBuffer(),
      left: PAD + (i % COLS) * (CELL + PAD),
      top: PAD + Math.floor(i / COLS) * (CELL + PAD),
    }))
  );
  await sharp({ create: { width: W, height: H, channels: 3, background: "#080d0a" } })
    .composite(tiles)
    .png()
    .toFile(outPath);
}

async function main() {
  const cast = ONLY.length ? CAST.filter((c) => ONLY.includes(Number(c.id))) : CAST.slice(0, COUNT);

  if (DRY) {
    console.log(`DRY RUN — ${cast.length} avatars, quality=${QUALITY}. Nothing generated, nothing spent.\n`);
    console.log(`ANCHOR (${cast[0].label}):\n${anchorPrompt(cast[0])}\n`);
    console.log(`SIBLING (${cast[1]?.label ?? "n/a"}):\n${cast[1] ? siblingPrompt(cast[1]) : ""}\n`);
    console.log(`Would write: ${OUT_DIR}/fan-XX.webp  +  ${WORK_DIR}/contact-sheet.png`);
    return;
  }

  if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });

  // The anchor is generated once and cached: every sibling must inherit from the
  // SAME image or the set drifts apart run over run.
  const anchorPath = join(WORK_DIR, "_anchor.png");
  let anchor;
  if (existsSync(anchorPath)) {
    anchor = readFileSync(anchorPath);
    console.log("anchor: reusing cached _anchor.png");
  } else {
    console.log(`anchor: generating from ${cast[0].label}…`);
    anchor = await textToImage(anchorPrompt(cast[0]));
    writeFileSync(anchorPath, anchor);
  }

  const written = [];
  for (const [i, c] of cast.entries()) {
    const raw = join(WORK_DIR, `fan-${c.id}.png`);
    try {
      const buf = i === 0 ? anchor : await editFromRef(siblingPrompt(c), anchor);
      writeFileSync(raw, buf);
      const out = join(OUT_DIR, `fan-${c.id}.webp`);
      await toAvatar(buf, out);
      written.push(raw);
      console.log(`  ✓ ${c.id} ${c.label}`);
    } catch (e) {
      // One bad generation shouldn't lose the whole run — the rest are still worth reviewing.
      console.error(`  ✗ ${c.id} ${c.label}: ${e.message}`);
    }
  }

  if (written.length) {
    const sheet = join(WORK_DIR, "contact-sheet.png");
    await contactSheet(written, sheet);
    console.log(`\nSHEET=${sheet}`);
    console.log(`AVATARS=${OUT_DIR} (${written.length} written)`);
    console.log("\nReview the sheet, then keep the winners and re-run the rest with --only.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
