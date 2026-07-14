#!/usr/bin/env node
/**
 * Blog article artwork — the SAME founder-locked style system as gen-quiz-images.mjs
 * (retro matchday poster = base · fan's-eye terraces in rotation · cinematic story +
 * comic ink for big moments), applied to editorial briefs instead of daily quizzes.
 *
 * Text-free background art only: titles/headlines are HTML overlay in the article, never
 * baked in. Football-only guard is inherited verbatim. Crests are NEVER model-drawn.
 *
 * Env: OPENAI_API_KEY.  Usage:
 *   node scripts/gen-blog-images.mjs                    # all briefs, high quality
 *   node scripts/gen-blog-images.mjs --only wildcard    # one brief
 *   node scripts/gen-blog-images.mjs --alt 1            # step the style rotation
 *   node scripts/gen-blog-images.mjs --out /tmp/sheet   # where PNGs land
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FONTS = join(ROOT, "scripts", "assets", "fonts");
const GOLD = "#ffc233";
const PLATE = "rgba(6,8,7,0.92)";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const OUT = flag("--out") || "/tmp/blog-art";
const QUALITY = flag("--quality") || "high";
const ONLY = flag("--only");
const ALT = Number.parseInt(flag("--alt") ?? "0", 10) || 0;

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

// Verbatim from gen-quiz-images.mjs — the football-only + no-text guard.
const NO_TEXT = `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO badges, NO watermarks anywhere in the image. No brand marks of any kind on kit, boots, socks or balls — no swoosh, no stripes, no manufacturer marks, plain unbranded kit and plain unbranded boots. Keep the upper-left third as calmer, darker negative space for a title to be added later. This is ASSOCIATION FOOTBALL (soccer) ONLY: any ball must be a round soccer ball with classic panels — NEVER an American football, NO egg-shaped balls, NO gridiron, NO helmets, NO shoulder pads. No identifiable real player likenesses and no real club badges — generic kits only.`;

// The blog is ONE article set, not a daily rotation: the palette is LOCKED to the
// YourScore brand world (gold on deep pitch) so the four posts read as one system.
const BLOG_PALETTE = "deep pitch green, rich gold and off-white cream, near-black shadows";

/**
 * Each brief carries its own SUBJECT; the STYLE wrapper is the locked house look.
 * s2 = retro matchday poster (base) · s4 = fan's-eye terraces · s1 = cinematic · s3 = ink
 */
const BRIEFS = {
  transfers: {
    file: "window-verdicts.png",
    style: 1,
    headline: ["SUMMER 2026", "WINDOW"],
    sub: "EVERY CONFIRMED DEAL. ONE FANTASY VERDICT EACH.",
    subject:
      "a transfer-deadline scene: a footballer in a plain kit signing a contract at a table under the glare of press camera flashes, a club scarf held up behind him, blurred photographers in the dark",
  },
  wildcard: {
    file: "perfect-round-wildcard.png",
    style: 3,
    headline: ["PERFECT ROUND", "= WILDCARD"],
    sub: "A DEAD TEAM IS NEVER DEAD",
    strip: ["11/11 CORRECT", "→", "BONUS WILDCARD", "→", "REBUILD FREE"],
    subject:
      "an explosive celebration: a footballer wheeling away arms outstretched in triumph, gold confetti bursting through floodlight beams, the crowd a roaring blur behind",
  },
  credits: {
    file: "pay-in-knowledge.png",
    style: 2,
    headline: ["PAY IN KNOWLEDGE,", "OR PAY IN POINTS"],
    sub: "CREDITS BANK UP TO FIVE",
    strip: ["RIGHT ANSWER = CREDIT", "BANK MAX 5", "EXTRA MOVE = POINTS HIT"],
    subject:
      "a manager's decision moment: a lone figure in a long coat at the edge of a floodlit pitch, hands in pockets, deep in thought, a tactics board and stacked coins motif abstracted into the poster geometry",
  },
  earned: {
    file: "rationed-vs-earned.png",
    style: 2,
    headline: ["RATIONED", "VS EARNED"],
    sub: "KNOW MORE. MOVE MORE.",
    strip: ["EVERY OTHER GAME: 1 FREE MOVE A WEEK", "YOURSCORE: YOUR KNOWLEDGE EARNS THEM"],
    subject:
      "two halves of one poster: on the left a static footballer standing still in muted grey tones, on the right the same figure exploding into a sprint in vivid gold, a bold vertical divide between them",
  },
  quiz: {
    file: "five-rounds.png",
    style: 4,
    headline: ["50 QUESTIONS.", "FIVE ROUNDS."],
    sub: "EASY TO EVIL. HOW FAR DO YOU GET?",
    strip: ["WARM-UP", "CASUAL", "PROPER FAN", "OBSESSIVE", "YOU NEED HELP"],
    subject:
      "a packed terrace of fans at night, scarves raised, faces lit by the floodlights, tension on every face as though watching a penalty in the last minute",
  },
  loop: {
    file: "weekly-loop.png",
    style: 2,
    headline: ["THE WEEKLY", "LOOP"],
    sub: "EVERY GAMEWEEK, ALL SEASON",
    strip: ["KNOWLEDGE ROUND", "→", "TRANSFER CREDITS", "→", "YOUR MOVES", "→", "MATCHES SCORE"],
    subject:
      "an abstract cyclical motif: a football at the centre of a bold circular arrow of five segments, floodlight rays radiating outward, stadium geometry beneath",
  },
};

function stylePrompt(style, subject) {
  switch (style) {
    case 1:
      return `Cinematic photographic sports key art: ${subject}. Colour grade locked to ${BLOG_PALETTE}: deep pitch-green night, warm gold floodlight glow, cream highlights. Shallow depth of field, broadcast key-art finish, subtle cinematic grain. ${NO_TEXT}`;
    case 2:
      return `Flat graphic illustration in vintage football matchday-poster style: ${subject}. Bold simplified geometric shapes, screen-print texture, STRICTLY limited palette of ${BLOG_PALETTE} and nothing else, clean geometric floodlight rays, halftone crowd texture below. Mid-century poster composition, thick shapes, no gradients. ${NO_TEXT}`;
    case 3:
      return `Dramatic graphic-novel comic panel: ${subject}. Bold black ink outlines, dynamic low camera angle, speed lines, halftone dot shading, STRICTLY limited comic palette of ${BLOG_PALETTE} with white highlights. ${NO_TEXT}`;
    case 4:
      return `Photographic shot from INSIDE a football crowd at night: ${subject}. Colour grade locked to ${BLOG_PALETTE}: deep pitch-green night, warm gold floodlight haze. Emotional documentary feel, shallow depth of field, cinematic grain. ${NO_TEXT}`;
    default:
      throw new Error(`unknown style ${style}`);
  }
}

// ── Overlay: headline on black plates + subline + a data strip (the infographic bit) ──
// Founder-locked (Jul 7): every headline sits on a black plate. Satori needs display:flex
// on every container and explicit children — bare arrays render 0-byte PNGs.
const bebas = readFileSync(join(FONTS, "BebasNeue-Regular.ttf"));
const dmBold = readFileSync(join(FONTS, "DMSans-Bold.ttf"));
const logoDataUri = `data:image/png;base64,${readFileSync(join(ROOT, "public", "logo.png")).toString("base64")}`;
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });

function overlayTree(W, H, brief) {
  const pad = Math.round(W * 0.05);
  const logoH = Math.round(W * 0.042);
  const titleSize = Math.round(W * 0.072);
  const subSize = Math.round(W * 0.019);
  const chipSize = Math.round(W * 0.0155);

  const line = (text, accent) =>
    h("div", { style: { display: "flex" } },
      h("div", {
        style: {
          display: "flex", color: accent ? GOLD : "#ffffff", backgroundColor: PLATE,
          paddingTop: Math.round(titleSize * 0.06), paddingBottom: Math.round(titleSize * 0.10),
          paddingLeft: Math.round(titleSize * 0.14), paddingRight: Math.round(titleSize * 0.14),
        },
      }, text)
    );

  const kids = [
    h("img", { src: logoDataUri, width: Math.round(logoH * 3.382), height: logoH, style: { marginBottom: Math.round(H * 0.035) } }),
    h("div", { style: { display: "flex", flexDirection: "column", fontSize: titleSize, lineHeight: 0.92, rowGap: Math.round(titleSize * 0.08) } },
      ...brief.headline.map((t, i) => line(t, i === brief.headline.length - 1))),
  ];

  if (brief.sub) {
    kids.push(h("div", {
      style: {
        display: "flex", alignSelf: "flex-start", marginTop: Math.round(H * 0.028),
        fontFamily: "DM Sans", fontWeight: 700, fontSize: subSize, letterSpacing: subSize * 0.22,
        color: GOLD, backgroundColor: PLATE,
        paddingTop: Math.round(subSize * 0.45), paddingBottom: Math.round(subSize * 0.45),
        paddingLeft: Math.round(subSize * 0.7), paddingRight: Math.round(subSize * 0.7),
      },
    }, brief.sub));
  }

  if (brief.strip) {
    const chips = brief.strip.map((t) =>
      t === "→"
        // Bebas/DM Sans carry no arrow glyph (renders as tofu) — draw a gold bar+chevron.
        ? h("div", { style: { display: "flex", alignItems: "center", marginLeft: 8, marginRight: 16 } },
            h("div", { style: { display: "flex", width: Math.round(chipSize * 1.2), height: 3, backgroundColor: GOLD } }),
            h("div", { style: { display: "flex", width: 0, height: 0,
              borderTop: `${Math.round(chipSize * 0.34)}px solid transparent`,
              borderBottom: `${Math.round(chipSize * 0.34)}px solid transparent`,
              borderLeft: `${Math.round(chipSize * 0.46)}px solid ${GOLD}` } })
          )
        : h("div", {
            style: {
              display: "flex", fontFamily: "DM Sans", fontWeight: 700, fontSize: chipSize,
              letterSpacing: chipSize * 0.12, color: "#ffffff", backgroundColor: PLATE,
              borderRadius: 6, marginRight: 10,
              paddingTop: Math.round(chipSize * 0.5), paddingBottom: Math.round(chipSize * 0.5),
              paddingLeft: Math.round(chipSize * 0.75), paddingRight: Math.round(chipSize * 0.75),
            },
          }, t)
    );
    kids.push(h("div", {
      style: { display: "flex", position: "absolute", left: pad, bottom: pad, flexWrap: "wrap", alignItems: "center" },
    }, ...chips));
  }

  kids.push(h("div", { style: { display: "flex", position: "absolute", left: 0, bottom: 0, width: W, height: Math.round(H * 0.014), backgroundColor: GOLD } }));

  return h("div", {
    style: { width: W, height: H, display: "flex", flexDirection: "column", padding: pad, fontFamily: "Bebas Neue", position: "relative" },
  }, ...kids);
}

async function renderOverlay(W, H, brief) {
  const svg = await satori(overlayTree(W, H, brief), {
    width: W, height: H,
    fonts: [
      { name: "Bebas Neue", data: bebas, weight: 400, style: "normal" },
      { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
}

const REUSE_BG = args.includes("--reuse-bg"); // free overlay iteration on cached art

async function genArt(brief, prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", quality: QUALITY, n: 1 }),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 240)}`);
  return Buffer.from(j.data[0].b64_json, "base64");
}

async function gen(name, brief) {
  const W = 1600, H = 900;
  const prompt = stylePrompt(brief.style, brief.subject);
  process.stdout.write(`→ ${name} (style ${brief.style})… `);
  mkdirSync(OUT, { recursive: true });
  const cache = join(OUT, `_bg-${name}.png`);
  let art;
  if (REUSE_BG && existsSync(cache)) { art = readFileSync(cache); }
  else { art = await genArt(brief, prompt); writeFileSync(cache, art); }
  const bg = await sharp(art).resize(W, H, { fit: "cover", position: "centre" }).toBuffer();
  const overlay = await renderOverlay(W, H, brief);
  const out = join(OUT, brief.file);
  await sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(out);
  console.log(`ok → ${out}`);
  return true;
}

const entries = Object.entries(BRIEFS).filter(([n]) => !ONLY || n === ONLY);
for (const [name, brief] of entries) {
  await gen(name, brief);
}
console.log(`\nDone. Contact-sheet these before anything ships (locked creative rule).`);
