/**
 * question-card-gen.mjs — render a 1080×1350 "hard question" card PNG, styled like
 * the in-app quiz (same design system as the Guru card) but with NO answer revealed:
 * all four options neutral, hero = "ONLY {pct}% GOT THIS RIGHT".
 *
 * Usage:
 *   node scripts/social/question-card-gen.mjs --question "..." --options '["a","b","c","d"]' \
 *        --pct 16 [--category history] [--difficulty hard] [--out path.png]
 *
 * Prints the PNG path to stdout.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : undefined; };

const question = flag("question");
const pct = flag("pct");
if (!question || !pct) { console.error('Need --question "..." and --pct N'); process.exit(1); }
let options = [];
try { options = JSON.parse(flag("options") || "[]"); } catch {}
if (!Array.isArray(options)) options = ["A", "B", "C", "D"].map((l) => options[l] ?? options[l.toLowerCase()] ?? "");
const category = flag("category") || "football";
const difficulty = flag("difficulty") || "hard";
const ukToday = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const outPath = flag("out") || join(ROOT, "scripts/data", `hard-question-${ukToday}.png`);

const logoUri = `data:image/png;base64,${readFileSync(join(ROOT, "public/logo.png")).toString("base64")}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const letters = ["A", "B", "C", "D"];
const optionsHtml = options.slice(0, 4).map((text, i) => `
      <div class="opt">
        <div class="opt-lbl">${letters[i]}</div>
        <div class="opt-text">${esc(text)}</div>
      </div>`).join("\n");
const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1350px; overflow: hidden; background: #030d05; }
.card { width: 1080px; height: 1350px; background: #030d05; position: relative; overflow: hidden;
  display: flex; flex-direction: column; font-family: 'DM Sans', system-ui, sans-serif; }
.card::before { content: ''; position: absolute; inset: 0; opacity: 0.45;
  background-image: radial-gradient(rgba(174,234,0,0.18) 1px, transparent 1.4px);
  background-size: 22px 22px; pointer-events: none; z-index: 0; }
.glow { position: absolute; top: -80px; left: 50%; transform: translateX(-50%);
  width: 1200px; height: 900px;
  background: radial-gradient(ellipse at 50% 38%, rgba(174,234,0,0.12) 0%, transparent 60%);
  pointer-events: none; z-index: 1; }
.hero { position: relative; z-index: 2; flex-shrink: 0; padding: 70px 72px 0; }
.hero-pre { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 64px; line-height: 1;
  letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.55); }
.hero-title { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 168px; line-height: 0.9;
  color: #aeea00; letter-spacing: 0.02em; text-shadow: 0 0 70px rgba(174,234,0,0.28); }
.hero-sub { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 64px; line-height: 1.05;
  letter-spacing: 0.06em; text-transform: uppercase; color: #ffffff; margin-top: 6px; }
.quiz-card { position: relative; z-index: 2; flex: 1; margin: 44px 64px 0; background: #0e1611;
  border-radius: 24px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden;
  display: flex; flex-direction: column; }
.quiz-bar { display: flex; align-items: center; justify-content: space-between;
  padding: 18px 28px; border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02); flex-shrink: 0; }
.diff-pill { font-size: 13px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  padding: 5px 14px; border-radius: 999px; background: rgba(255,71,87,0.12); color: #ff4757;
  border: 1px solid rgba(255,71,87,0.25); }
.cat-tag { font-size: 15px; font-weight: 500; color: rgba(255,255,255,0.28); }
.quiz-question { font-size: 42px; font-weight: 600; color: #ffffff; line-height: 1.35;
  padding: 32px 32px 22px; flex-shrink: 0; }
.quiz-options { display: flex; flex-direction: column; gap: 10px; padding: 0 20px 22px;
  flex: 1; justify-content: center; }
.opt { display: flex; align-items: center; gap: 18px; border-radius: 16px; padding: 18px 22px;
  border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.03); }
.opt-lbl { width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Bebas Neue', Impact, sans-serif; font-size: 24px;
  background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.6); }
.opt-text { font-size: 29px; font-weight: 500; color: rgba(255,255,255,0.78); line-height: 1.3; }
.footer { position: relative; z-index: 2; flex-shrink: 0; padding: 26px 64px 42px; margin-top: 22px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: space-between; }
.footer img { height: 48px; width: auto; mix-blend-mode: screen; }
.footer-tag { font-size: 18px; color: rgba(174,234,0,0.55); letter-spacing: 0.12em;
  text-transform: uppercase; font-weight: 700; }
</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="hero">
    <div class="hero-pre">Only</div>
    <div class="hero-title">${esc(pct)}%</div>
    <div class="hero-sub">got this right</div>
  </div>
  <div class="quiz-card">
    <div class="quiz-bar">
      <div class="diff-pill">${esc(diffLabel)}</div>
      <div class="cat-tag">${esc(category)}</div>
    </div>
    <div class="quiz-question">${esc(question)}</div>
    <div class="quiz-options">${optionsHtml}</div>
  </div>
  <div class="footer">
    <img src="${logoUri}" alt="YourScore">
    <div class="footer-tag">yourscore.app/play</div>
  </div>
</div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: outPath });
await browser.close();
console.log(outPath);
