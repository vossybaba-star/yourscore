/**
 * debate-card-gen.mjs — generate a 1080×1350 debate results card PNG.
 *
 * Usage:
 *   node --env-file=.env.local scripts/social/debate-card-gen.mjs           # yesterday (UK)
 *   node --env-file=.env.local scripts/social/debate-card-gen.mjs --date 2026-07-05
 *
 * Outputs the PNG path to stdout. PNG is saved to scripts/data/debate-card-<date>.png.
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function ukDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
export const targetDate = flag("--date") || ukDate(-1);

const { data: debate, error: debateErr } = await db
  .from("debates")
  .select("id, question, options")
  .eq("day", targetDate)
  .single();

if (debateErr || !debate) {
  console.error(`No debate found for ${targetDate}:`, debateErr?.message ?? "no row");
  process.exit(1);
}

const { data: votes } = await db
  .from("debate_votes")
  .select("option_idx")
  .eq("debate_id", debate.id);

const total = votes?.length ?? 0;
const countA = votes?.filter((v) => v.option_idx === 0).length ?? 0;
const pctA = total > 0 ? Math.round((countA / total) * 100) : 50;
const pctB = 100 - pctA;
const aWins = pctA >= pctB;
const optA = debate.options[0];
const optB = debate.options[1];

const displayDate = new Date(targetDate + "T12:00:00Z").toLocaleDateString("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

const logoB64 = readFileSync(join(ROOT, "public/logo.png")).toString("base64");
const logoDataUri = `data:image/png;base64,${logoB64}`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1350px; overflow: hidden; background: #000; }
.card {
  width: 1080px; height: 1350px; background: #030d05;
  position: relative; overflow: hidden; display: flex; flex-direction: column;
  padding: 96px 88px 80px; font-family: 'DM Sans', system-ui, sans-serif;
}
.card::before {
  content: ''; position: absolute; inset: 0; opacity: 0.5;
  background-image: radial-gradient(rgba(174, 234, 0, 0.18) 1px, transparent 1.4px);
  background-size: 22px 22px; pointer-events: none; z-index: 0;
}
.card > * { position: relative; z-index: 1; }
.label { font-size: 22px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: #00d8c0; margin-bottom: 44px; }
.question { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 104px; line-height: 1.0; color: #ffffff; margin-bottom: 72px; }
.rule { width: 80px; height: 3px; background: #00d8c0; margin-bottom: 72px; flex-shrink: 0; }
.results { display: flex; flex-direction: column; gap: 56px; flex: 1; }
.result-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; }
.opt-label { font-size: 30px; font-weight: 500; color: rgba(255,255,255,0.75); }
.pct { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 112px; line-height: 1; }
.pct.lime { color: #aeea00; } .pct.teal { color: #00d8c0; }
.bar-track { width: 100%; height: 12px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 2px; }
.bar-fill.lime { background: #aeea00; } .bar-fill.teal { background: #00d8c0; }
.vote-count { font-size: 22px; color: rgba(255,255,255,0.22); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 36px; }
.footer { margin-top: auto; padding-top: 48px; border-top: 1px solid rgba(255,255,255,0.07); display: flex; align-items: center; justify-content: space-between; }
.footer img { height: 56px; width: auto; mix-blend-mode: screen; }
.tagline { font-size: 20px; color: rgba(0,216,192,0.55); letter-spacing: 0.12em; text-transform: uppercase; }
</style>
</head>
<body>
<div class="card">
  <div class="label">The Debate · ${displayDate}</div>
  <div class="question">${debate.question}</div>
  <div class="rule"></div>
  <div class="results">
    <div class="result-row">
      <div class="result-top">
        <div class="opt-label">${optA}</div>
        <div class="pct ${aWins ? "lime" : "teal"}">${pctA}%</div>
      </div>
      <div class="bar-track"><div class="bar-fill ${aWins ? "lime" : "teal"}" style="width:${pctA}%"></div></div>
    </div>
    <div class="result-row">
      <div class="result-top">
        <div class="opt-label">${optB}</div>
        <div class="pct ${!aWins ? "lime" : "teal"}">${pctB}%</div>
      </div>
      <div class="bar-track"><div class="bar-fill ${!aWins ? "lime" : "teal"}" style="width:${pctB}%"></div></div>
    </div>
  </div>
  <div class="vote-count">${total} fan${total !== 1 ? "s" : ""} voted</div>
  <div class="footer">
    <img src="${logoDataUri}" alt="YourScore">
    <div class="tagline">yourscore.app · Daily Debate</div>
  </div>
</div>
</body>
</html>`;

const outDir = join(ROOT, "scripts/data");
mkdirSync(outDir, { recursive: true });
const htmlPath = join(outDir, `debate-card-${targetDate}.html`);
const pngPath = join(outDir, `debate-card-${targetDate}.png`);
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1080, height: 1350 });
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
await page.screenshot({ path: pngPath, fullPage: false });
await browser.close();
unlinkSync(htmlPath);

// Export metadata for importers
export const debateSummary = { date: targetDate, displayDate, question: debate.question, optA, optB, pctA, pctB, total };
export const pngFilePath = pngPath;

console.log(pngPath);
