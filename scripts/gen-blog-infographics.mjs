#!/usr/bin/env node
/**
 * Blog INFOGRAPHICS — in-body explainer diagrams, not cover art.
 *
 * Layer 1: AI artwork from gen-blog-images.mjs (approved style system), dimmed.
 * Layer 2: the diagram — step boxes, credit dots, ladders, split labels.
 * No logo, no cover headline: these sit INSIDE an article next to the prose.
 *
 * Usage: node scripts/gen-blog-infographics.mjs --art <dir-of-bg-pngs> --out <dir>
 *   (--art expects the `_bg-<name>.png` files gen-blog-images.mjs caches)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const ART = flag("--art") || "/tmp/blog-art";
const OUT = flag("--out") || "/tmp/blog-infographics";

const G = "#ffc233";
const W = 1600, H = 720;
const F = `font-family="Bebas Neue, Arial Black, Arial, sans-serif"`;
const F2 = `font-family="DM Sans, Arial, sans-serif"`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Gold chevron arrow, drawn (no font glyph → no tofu).
const arrow = (x, y, s = 1) =>
  `<g transform="translate(${x},${y}) scale(${s})"><rect x="0" y="-2" width="26" height="4" fill="${G}"/><polygon points="26,-9 42,0 26,9" fill="${G}"/></g>`;

const chip = (x, y, w, h, label, sub) => {
  // Bebas is condensed (~0.42em/char); shrink the label until it fits the plate.
  const size = Math.min(34, Math.floor((w - 40) / (label.length * 0.44)));
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="rgba(6,8,7,0.92)" stroke="${G}" stroke-width="2"/>
  <text x="${x + w / 2}" y="${y + (sub ? h * 0.42 : h / 2 + size * 0.36)}" ${F} font-size="${size}" fill="${G}" text-anchor="middle" letter-spacing="1">${esc(label)}</text>
  ${sub ? `<text x="${x + w / 2}" y="${y + h * 0.72}" ${F2} font-size="19" fill="#c4ccc6" text-anchor="middle">${esc(sub)}</text>` : ""}`;
};

// caption bar bottom-left: what this diagram says, in one line
const caption = (text) => `
  <rect x="0" y="${H - 62}" width="${W}" height="50" fill="rgba(6,8,7,0.86)"/>
  <rect x="0" y="${H - 62}" width="6" height="50" fill="${G}"/>
  <text x="26" y="${H - 29}" ${F2} font-weight="700" font-size="22" fill="#ffffff" letter-spacing="1">${esc(text)}</text>
  <rect x="0" y="${H - 12}" width="${W}" height="12" fill="${G}"/>`;

const scrim = `<rect width="${W}" height="${H}" fill="rgba(4,8,6,0.62)"/>`;

const DIAGRAMS = {
  loop: {
    art: "loop",
    file: "weekly-loop.svg",
    alt: "The weekly loop in YourScore Fantasy Football: knowledge round earns transfer credits, you make your moves, the deadline locks, real matches score your team",
    draw() {
      const steps = [["KNOWLEDGE", "ROUND"], ["TRANSFER", "CREDITS"], ["MAKE YOUR", "MOVES"], ["DEADLINE", "LOCKS"], ["MATCHES", "SCORE"]];
      const bw = 250, bh = 120, gap = 45, y = 300;
      let s = `<text x="60" y="150" ${F} font-size="56" fill="#ffffff" letter-spacing="1">THE WEEKLY LOOP</text>`;
      steps.forEach(([a, b], i) => {
        const x = 60 + i * (bw + gap);
        s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="12" fill="rgba(6,8,7,0.90)" stroke="${G}" stroke-width="2"/>`;
        s += `<text x="${x + bw / 2}" y="${y + 52}" ${F} font-size="32" fill="${G}" text-anchor="middle">${a}</text>`;
        s += `<text x="${x + bw / 2}" y="${y + 90}" ${F} font-size="32" fill="${G}" text-anchor="middle">${b}</text>`;
        if (i < steps.length - 1) s += arrow(x + bw + 4, y + bh / 2, 0.85);
      });
      return s + caption("EVERY GAMEWEEK, ALL SEASON. KNOW MORE, MOVE MORE.");
    },
  },

  credits: {
    art: "credits",
    file: "pay-in-knowledge.svg",
    alt: "Transfer credits bank up to five in YourScore Fantasy Football, and moves beyond your credits cost points",
    draw() {
      let s = `<text x="60" y="140" ${F} font-size="54" fill="#ffffff">PAY IN KNOWLEDGE,</text>`;
      s += `<text x="60" y="205" ${F} font-size="54" fill="${G}">OR PAY IN POINTS.</text>`;
      s += `<text x="60" y="262" ${F2} font-size="23" fill="#c4ccc6">Right answers earn transfer credits. Harder questions earn more.</text>`;
      // credit bank
      s += `<text x="60" y="345" ${F2} font-weight="700" font-size="20" fill="${G}" letter-spacing="2">YOUR CREDIT BANK</text>`;
      for (let i = 0; i < 5; i++) {
        const x = 60 + i * 92;
        s += `<circle cx="${x + 32}" cy="410" r="30" fill="${i < 3 ? G : "none"}" stroke="${G}" stroke-width="3"/>`;
        if (i < 3) s += `<text x="${x + 32}" y="420" ${F} font-size="30" fill="#06120b" text-anchor="middle">✓</text>`;
      }
      s += `<text x="${60 + 5 * 92 + 20}" y="420" ${F2} font-size="21" fill="#c4ccc6">3 banked. Max 5. Spend now or save for the big rebuild.</text>`;
      s += chip(1050, 330, 490, 165, "BEYOND YOUR CREDITS", "Every extra move costs you points");
      return s + caption("PAY FOR IT IN KNOWLEDGE, OR PAY FOR IT IN POINTS. YOUR CALL, EVERY DEADLINE.");
    },
  },

  wildcard: {
    art: "wildcard",
    anchor: "top",
    file: "perfect-round-wildcard.svg",
    alt: "A perfect knowledge round mints a bonus wildcard in YourScore Fantasy Football, letting you rebuild your whole squad free",
    draw() {
      let s = `<text x="60" y="150" ${F} font-size="56" fill="#ffffff">A DEAD TEAM IS NEVER DEAD</text>`;
      s += `<text x="60" y="205" ${F2} font-size="23" fill="#c4ccc6">One big round mints your comeback.</text>`;
      const y = 330, bw = 380, bh = 140;
      s += chip(60, y, bw, bh, "11 / 11", "A perfect knowledge round");
      s += arrow(60 + bw + 22, y + bh / 2, 1.1);
      s += chip(60 + bw + 110, y, bw, bh, "BONUS WILDCARD", "One per half-season, on top of yours");
      s += arrow(60 + 2 * bw + 132, y + bh / 2, 1.1);
      s += chip(60 + 2 * bw + 220, y, bw, bh, "REBUILD FREE", "Unlimited transfers, no points hit");
      return s + caption("EARNED, NEVER BOUGHT. NOTHING IN YOURSCORE FANTASY FOOTBALL IS PAY-TO-WIN.");
    },
  },

  earned: {
    art: "earned",
    anchor: "top",
    file: "rationed-vs-earned.svg",
    alt: "Every other fantasy game rations transfers to one a week; in YourScore Fantasy Football your football knowledge earns your moves",
    draw() {
      let s = `<line x1="800" y1="120" x2="800" y2="470" stroke="rgba(255,194,51,0.35)" stroke-width="2" stroke-dasharray="10 10"/>`;
      s += `<rect x="60" y="130" width="660" height="240" rx="12" fill="rgba(6,8,7,0.86)"/>`;
      s += `<text x="390" y="190" ${F} font-size="40" fill="#7a857d" text-anchor="middle">EVERY OTHER GAME</text>`;
      s += `<text x="390" y="255" ${F} font-size="46" fill="#c4ccc6" text-anchor="middle">1 FREE TRANSFER</text>`;
      s += `<text x="390" y="305" ${F} font-size="46" fill="#c4ccc6" text-anchor="middle">A WEEK</text>`;
      s += `<text x="390" y="348" ${F2} font-size="20" fill="#7a857d" text-anchor="middle">Whatever you know. Same for everyone.</text>`;
      s += `<rect x="880" y="130" width="660" height="240" rx="12" fill="rgba(6,8,7,0.90)" stroke="${G}" stroke-width="2"/>`;
      s += `<text x="1210" y="190" ${F} font-size="40" fill="#ffffff" text-anchor="middle">YOURSCORE FANTASY FOOTBALL</text>`;
      s += `<text x="1210" y="255" ${F} font-size="46" fill="${G}" text-anchor="middle">YOUR KNOWLEDGE</text>`;
      s += `<text x="1210" y="305" ${F} font-size="46" fill="${G}" text-anchor="middle">EARNS YOUR MOVES</text>`;
      s += `<text x="1210" y="348" ${F2} font-size="20" fill="#c4ccc6" text-anchor="middle">Bank up to 5. A perfect round mints a wildcard.</text>`;
      s += `<text x="800" y="440" ${F} font-size="44" fill="${G}" text-anchor="middle">KNOW MORE. MOVE MORE.</text>`;
      return s + caption("TRANSFERS ARE THE GAME. WE MAKE YOU EARN THEM.");
    },
  },

  quiz: {
    art: "quiz",
    anchor: "top",
    file: "five-rounds.svg",
    alt: "Fifty Premier League quiz questions across five rounds of rising difficulty, from warm-up to you need help",
    draw() {
      let s = `<text x="60" y="150" ${F} font-size="56" fill="#ffffff">50 QUESTIONS. FIVE ROUNDS.</text>`;
      s += `<text x="60" y="212" ${F} font-size="56" fill="${G}">EASY TO EVIL.</text>`;
      s += `<text x="60" y="268" ${F2} font-size="22" fill="#c4ccc6">Do all fifty in the group chat. Lowest score buys the round.</text>`;
      const rounds = [["WARM-UP", 90], ["CASUAL", 140], ["PROPER FAN", 195], ["OBSESSIVE", 250], ["YOU NEED HELP", 305]];
      rounds.forEach(([name, hgt], i) => {
        const x = 840 + i * 150;
        s += `<rect x="${x}" y="${470 - hgt}" width="112" height="${hgt}" rx="8" fill="${G}" opacity="${(0.4 + i * 0.15).toFixed(2)}"/>`;
        s += `<text x="${x + 56}" y="${462 - hgt - 12}" ${F} font-size="26" fill="${G}" text-anchor="middle">R${i + 1}</text>`;
        s += `<text x="${x + 56}" y="496" ${F2} font-size="15" fill="#c4ccc6" text-anchor="middle">${esc(name)}</text>`;
      });
      return s + caption("ROUND 3 IS WHERE YOUR MATE WHO CALLS IT THE EPL TAPS OUT.");
    },
  },

  transfers: {
    art: "transfers",
    anchor: "top",
    file: "window-verdicts.svg",
    alt: "Summer 2026 Premier League transfer window: every confirmed deal with one fantasy verdict each",
    draw() {
      let s = `<text x="60" y="200" ${F} font-size="62" fill="#ffffff">SUMMER 2026 WINDOW</text>`;
      s += `<text x="60" y="272" ${F} font-size="62" fill="${G}">EVERY DEAL. ONE VERDICT.</text>`;
      s += `<text x="60" y="330" ${F2} font-size="23" fill="#c4ccc6">Confirmed moves only. Receipts attached. Rumours quarantined.</text>`;
      s += chip(1050, 220, 490, 160, "UPDATED TO 1 SEPT", "Living post, every deal checked");
      return s + caption("PLANNING A FANTASY TEAM MID-WINDOW IS GUESSWORK. THIS IS THE CHEAT SHEET.");
    },
  },
};

const ONLY = flag("--only");
mkdirSync(OUT, { recursive: true });

for (const [name, d] of Object.entries(DIAGRAMS)) {
  if (ONLY && name !== ONLY) continue;
  const artPath = join(ART, `_bg-${d.art}.png`);
  if (!existsSync(artPath)) { console.error(`missing art: ${artPath}`); continue; }
  const bg = await sharp(readFileSync(artPath)).resize(W, H, { fit: "cover", position: d.anchor || "centre" }).png().toBuffer();
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${scrim}${d.draw()}</svg>`
  );
  const out = join(OUT, d.file.replace(/\.svg$/, ".png"));
  await sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).png({ quality: 90 }).toFile(out);
  console.log(`✓ ${name} → ${out}`);
  writeFileSync(join(OUT, `${name}.alt.txt`), d.alt);
}
console.log("\nContact-sheet before shipping (locked creative rule).");
