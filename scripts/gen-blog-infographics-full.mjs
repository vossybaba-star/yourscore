#!/usr/bin/env node
/**
 * Blog infographics — FULL generation by gpt-image-1, text baked in by the model.
 * No programmatic overlay: the prompt briefs the model on the whole diagram, the exact
 * copy to render, the style, and the palette. Each brief is self-contained.
 *
 * Locked style (same world as the quiz covers): flat vintage matchday-poster / editorial
 * sports-infographic look, deep pitch green + rich gold + cream, near-black shadows.
 * Football (soccer) only. Text must be spelled EXACTLY as given.
 *
 * Env: OPENAI_API_KEY.  Usage:
 *   node scripts/gen-blog-infographics-full.mjs --out <dir> [--only wildcard]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const OUT = flag("--out") || "/tmp/blog-info-full";
const ONLY = flag("--only");
const QUALITY = flag("--quality") || "high";
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

// Shared brief preamble — WHAT this is and the non-negotiables, prepended to every image.
const HOUSE = `This is a horizontal EDITORIAL INFOGRAPHIC for a blog article about a fantasy football game called YourScore Fantasy Football. It must look like a designed magazine/website infographic, NOT a movie poster and NOT a game cover: clean layout, generous negative space, information laid out for quick reading. Visual style: flat vintage football matchday-poster illustration with screen-print texture and bold simple shapes, in the mould of a premium sports-editorial graphic. STRICT colour palette, nothing outside it: deep pitch green background, rich warm gold, off-white cream, near-black shadows. This is ASSOCIATION FOOTBALL (soccer) only — any ball is a round soccer ball, never American football, no helmets. No real club badges, no brand logos, no manufacturer marks (no swoosh, no stripes) on any kit. Render ALL text crisply and legibly in a bold condensed sports sans-serif, spelled EXACTLY as written, no extra or misspelled words. Keep headings large and captions smaller. Wide 3:2 format.`;

const BRIEFS = {
  loop: {
    file: "weekly-loop.png",
    alt: "The weekly loop in YourScore Fantasy Football: knowledge round earns transfer credits, you make your moves, the deadline locks, real matches score your team",
    prompt: `${HOUSE}

CONTENT — a left-to-right five-step process diagram titled "THE WEEKLY LOOP" (heading top-left). Five equal rounded boxes connected by gold arrows, each box a small icon above two lines of label:
1. "KNOWLEDGE ROUND" (icon: a quiz question mark)
2. "TRANSFER CREDITS" (icon: gold coins)
3. "MAKE YOUR MOVES" (icon: two arrows swapping)
4. "DEADLINE LOCKS" (icon: a padlock)
5. "MATCHES SCORE" (icon: a soccer ball hitting a net)
A caption strip along the very bottom reads: "EVERY GAMEWEEK, ALL SEASON. KNOW MORE, MOVE MORE." A subtle floodlit stadium sits faded in the background behind the boxes.`,
  },

  credits: {
    file: "pay-in-knowledge.png",
    alt: "Transfer credits bank up to five in YourScore Fantasy Football, and moves beyond your credits cost points",
    prompt: `${HOUSE}

CONTENT — an infographic titled "PAY IN KNOWLEDGE, OR PAY IN POINTS" (two-line heading top-left, the second line in gold). Below the heading a small line: "Right answers earn transfer credits. Harder questions earn more." In the lower-left, a labelled row of FIVE circles representing a credit bank — the first three filled gold with a tick, the last two empty outlines — under a small gold label "YOUR CREDIT BANK", with a note beside it "3 banked. Max 5." On the right side, a bold outlined callout box reads "BEYOND YOUR CREDITS" with a smaller line under it "Every extra move costs you points." A faded silhouette of a manager in a long coat studying a tactics board sits in the background. Bottom caption strip: "PAY FOR IT IN KNOWLEDGE, OR PAY FOR IT IN POINTS."`,
  },

  wildcard: {
    file: "perfect-round-wildcard.png",
    alt: "A perfect knowledge round mints a bonus wildcard in YourScore Fantasy Football, letting you rebuild your whole squad free",
    prompt: `${HOUSE}

CONTENT — an infographic with a bold heading top-left "A DEAD TEAM IS NEVER DEAD" and a small line under it "One big round mints your comeback." Across the middle, a three-step flow of rounded boxes joined by gold arrows:
box 1 large gold text "11/11" with small caption "A perfect knowledge round"
→ box 2 "BONUS WILDCARD" with small caption "One per half-season"
→ box 3 "REBUILD FREE" with small caption "Unlimited transfers, no points hit"
On the right, a jubilant footballer in a plain kit celebrating arms-outstretched with gold confetti (comic-ink illustrated). Bottom caption strip: "EARNED, NEVER BOUGHT. NOTHING HERE IS PAY-TO-WIN."`,
  },

  earned: {
    file: "rationed-vs-earned.png",
    alt: "Every other fantasy game rations transfers to one a week; in YourScore Fantasy Football your football knowledge earns your moves",
    prompt: `${HOUSE}

CONTENT — a split-screen comparison infographic divided down the middle by a vertical gold dashed line.
LEFT half (muted grey-green, a static standing footballer silhouette): heading "EVERY OTHER GAME", big text "1 FREE TRANSFER A WEEK", small line "Whatever you know. Same for everyone."
RIGHT half (vivid gold, a footballer bursting into a sprint): heading "YOURSCORE FANTASY FOOTBALL", big gold text "YOUR KNOWLEDGE EARNS YOUR MOVES", small line "Bank up to 5. A perfect round mints a wildcard."
Centred across the bottom, large gold text: "KNOW MORE. MOVE MORE." Bottom caption strip: "TRANSFERS ARE THE GAME. WE MAKE YOU EARN THEM."`,
  },

  quiz: {
    file: "five-rounds.png",
    alt: "Fifty Premier League quiz questions across five rounds of rising difficulty, from warm-up to you need help",
    prompt: `${HOUSE}

CONTENT — an infographic titled "50 QUESTIONS. FIVE ROUNDS. EASY TO EVIL." (heading top-left, "EASY TO EVIL" in gold) with a small line "Do all fifty in the group chat. Lowest score buys the round." On the right two-thirds, a rising bar-chart of FIVE gold bars getting taller left to right, each bar labelled beneath: "WARM-UP", "CASUAL", "PROPER FAN", "OBSESSIVE", "YOU NEED HELP", and numbered "R1" to "R5" on top. A faded night-time terrace crowd with raised scarves behind the bars. Bottom caption strip: "ROUND 3 IS WHERE YOUR MATE WHO CALLS IT THE EPL TAPS OUT."`,
  },

  transfers: {
    file: "window-verdicts.png",
    alt: "Summer 2026 Premier League transfer window: every confirmed deal with one fantasy verdict each",
    prompt: `${HOUSE}

CONTENT — a header infographic for a transfer-news article. Large heading top-left over two lines: "SUMMER 2026 WINDOW" then "EVERY DEAL. ONE VERDICT." (second line gold). Small line under it: "Confirmed moves only. Receipts attached. Rumours quarantined." On the right, an illustrated scene of a footballer in a plain kit signing a contract at a table under camera flashes, a scarf raised behind. A small outlined tag reads "UPDATED TO 1 SEPT". Bottom caption strip: "PLANNING A FANTASY TEAM MID-WINDOW IS GUESSWORK. THIS IS THE CHEAT SHEET."`,
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, b] of Object.entries(BRIEFS)) {
  if (ONLY && name !== ONLY) continue;
  process.stdout.write(`→ ${name}… `);
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt: b.prompt, size: "1536x1024", quality: QUALITY, n: 1 }),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.b64_json) { console.log("FAIL"); console.error(JSON.stringify(j.error || j).slice(0, 240)); continue; }
  writeFileSync(join(OUT, b.file), Buffer.from(j.data[0].b64_json, "base64"));
  writeFileSync(join(OUT, `${name}.alt.txt`), b.alt);
  console.log(`ok → ${b.file}`);
}
console.log("\nReview every word for spelling before shipping (model-rendered text can garble).");
