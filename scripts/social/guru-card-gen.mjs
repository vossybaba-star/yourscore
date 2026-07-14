/**
 * guru-card-gen.mjs — generate the daily Question Guru social card.
 *
 * Finds today's hardest answered question (min 20 attempts, lowest correct%)
 * and the highest-ranked player who got it right, then renders a 1080×1350 PNG.
 *
 * Usage:
 *   node --env-file=.env.local scripts/social/guru-card-gen.mjs
 *   node --env-file=.env.local scripts/social/guru-card-gen.mjs --date 2026-07-07
 *
 * stdout: absolute path to generated PNG
 * Also writes scripts/data/guru-YYYY-MM-DD.json with metadata (user_id, email, question…)
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const args = process.argv.slice(2);
const dateArg = args[args.indexOf("--date") + 1] ?? undefined;
const ukToday = dateArg ?? new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

const PROJECT_REF = "mznvuswzgkaupvaqznkm";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) throw new Error("Missing SUPABASE_ACCESS_TOKEN — run with --env-file=.env.local");

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SQL failed: ${JSON.stringify(body)}`);
  return body;
}

// ── 1. Find today's hardest question + the best-ranked player who got it right ─
// quiz_attempts.answers is a JSONB array [{idx, correct, selected, points, elapsed_ms}]
// quiz_packs.questions is a JSONB array of full question objects ordered by position
const rows = await sql(`
  WITH per_answer AS (
    -- Quiz packs played at /play (answers jsonb, idx into quiz_packs.questions)
    SELECT qa.user_id, qp.questions->((a_elem->>'idx')::int) AS q, (a_elem->>'correct')::bool AS correct
    FROM quiz_attempts qa
    JOIN quiz_packs qp ON qp.id = qa.pack_id
    CROSS JOIN LATERAL jsonb_array_elements(qa.answers) a_elem
    WHERE qa.completed_at >= '${ukToday}'::date AND qa.completed_at < ('${ukToday}'::date + 1)
    UNION ALL
    -- Lobby games: answers -> question_events(sequence_number) -> rooms(pack_id) -> quiz_packs
    SELECT a.user_id, qp.questions->qe.sequence_number AS q, a.is_correct
    FROM answers a
    JOIN question_events qe ON a.question_event_id = qe.id
    JOIN rooms r ON qe.room_id = r.id
    JOIN quiz_packs qp ON r.pack_id = qp.id
    WHERE a.answered_at >= '${ukToday}'::date AND a.answered_at < ('${ukToday}'::date + 1)
    UNION ALL
    -- WC Mastermind gate answers (draft_wc_runs.quiz_answers, migration 76 — pack-shaped)
    SELECT r.user_id, (elem - 'selected' - 'correct') AS q, (elem->>'correct')::bool
    FROM draft_wc_runs r
    CROSS JOIN LATERAL jsonb_array_elements(r.quiz_answers) elem
    WHERE r.quiz_answers IS NOT NULL AND r.run_date = '${ukToday}'
  ),
  question_stats AS (
    SELECT q->>'question' AS question, q->>'answer' AS answer, q->'options' AS options,
           q->>'difficulty' AS difficulty, q->>'category' AS category,
           COUNT(*) AS attempts_today,
           SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS correct_today,
           ROUND(100.0 * SUM(CASE WHEN correct THEN 1 ELSE 0 END) / COUNT(*), 1) AS correct_pct
    FROM per_answer WHERE q IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5
    HAVING COUNT(*) >= 5
  ),
  top_question AS (SELECT * FROM question_stats ORDER BY correct_pct ASC LIMIT 1),
  -- The day's ranked WC Mastermind players + their best gate-quiz score
  wc AS (
    SELECT user_id, MAX(COALESCE(quiz_correct, 0)::float / NULLIF(quiz_total, 0)) AS gate_pct
    FROM draft_wc_runs WHERE run_date = '${ukToday}' AND ranked = true
    GROUP BY user_id
  ),
  guru_candidates AS (
    SELECT DISTINCT ON (pa.user_id)
      pa.user_id, p.display_name, p.username,
      COALESCE(r.overall_rank, 999999) AS rank,
      (w.user_id IS NOT NULL) AS wc_player,
      w.gate_pct
    FROM per_answer pa
    JOIN top_question tq ON pa.q->>'question' = tq.question
    JOIN profiles p ON p.id = pa.user_id
    LEFT JOIN yourscore_user_ratings r ON r.user_id = pa.user_id
    LEFT JOIN wc w ON w.user_id = pa.user_id
    WHERE pa.correct
    ORDER BY pa.user_id
  )
  SELECT tq.*, gc.user_id AS guru_user_id, gc.display_name AS guru_name, gc.username AS guru_username,
         gc.wc_player AS guru_wc_player, gc.gate_pct AS guru_gate_pct
  FROM top_question tq, guru_candidates gc
  -- Lead with WC Mastermind players: the noisy, repost-likely crowd (founder, Jul 9)
  ORDER BY gc.wc_player DESC, gc.gate_pct DESC NULLS LAST, gc.rank ASC
  LIMIT 1;
`);

if (!rows?.length) {
  console.error(`No question with ≥5 attempts found for ${ukToday} — skipping.`);
  process.exit(1);
}

const row = rows[0];
const question = row.question;
const options  = typeof row.options === "string" ? JSON.parse(row.options) : row.options;
const answer   = (row.answer ?? "").toUpperCase();
const category = row.category ?? "Football";
const difficulty = (row.difficulty ?? "hard");
const correctPct = parseFloat(row.correct_pct).toFixed(0);
const guruUserId = row.guru_user_id;
const guruRawName = row.guru_name || row.guru_username || "Player";
const guruUsername = row.guru_username || row.guru_name || "player";

// ── 2. Look up guru's email via auth.users ───────────────────────────────────
const emailRows = await sql(`SELECT email FROM auth.users WHERE id = '${guruUserId}' LIMIT 1;`);
const guruEmail = emailRows?.[0]?.email ?? null;

// ── 3. Build card HTML ───────────────────────────────────────────────────────
const logoB64    = readFileSync(join(ROOT, "public/logo.png")).toString("base64");
const logoUri    = `data:image/png;base64,${logoB64}`;
const badgeB64   = readFileSync(join(ROOT, "public/guru-badge.png")).toString("base64");
const badgeUri   = `data:image/png;base64,${badgeB64}`;

const displayDate = new Date(ukToday + "T12:00:00Z").toLocaleDateString("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

// Format name for big display — break into two lines at the midpoint
function heroName(name) {
  const words = name.trim().split(" ");
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2);
    return words.slice(0, mid).join(" ") + "<br>" + words.slice(mid).join(" ");
  }
  return name;
}

const letters = ["A", "B", "C", "D"];
const optionsHtml = letters.map(l => {
  const text = options[l] ?? options[l.toLowerCase()] ?? "";
  const isCorrect = answer === l;
  return `
      <div class="opt ${isCorrect ? "correct" : "faded"}">
        <div class="opt-lbl">${l}</div>
        <div class="opt-text">${text}</div>
      </div>`;
}).join("\n");

const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1350px; overflow: hidden; background: #030d05; }
.card {
  width: 1080px; height: 1350px; background: #030d05;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.card::before {
  content: ''; position: absolute; inset: 0; opacity: 0.45;
  background-image: radial-gradient(rgba(174,234,0,0.18) 1px, transparent 1.4px);
  background-size: 22px 22px; pointer-events: none; z-index: 0;
}
.glow { position: absolute; top: -80px; left: 50%; transform: translateX(-50%);
  width: 1200px; height: 900px;
  background: radial-gradient(ellipse at 50% 38%, rgba(0,216,192,0.1) 0%, transparent 60%);
  pointer-events: none; z-index: 1; }
.card-date { position: absolute; top: 52px; right: 72px; z-index: 3;
  font-size: 17px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: rgba(255,255,255,0.2); }
.hero { position: relative; z-index: 2; flex-shrink: 0; padding: 52px 72px 0; }
.hero-pre { font-family: 'Bebas Neue', Impact, sans-serif;
  font-size: 60px; line-height: 1; letter-spacing: 0.1em;
  text-transform: uppercase; color: rgba(0,216,192,0.7); }
.hero-title { font-family: 'Bebas Neue', Impact, sans-serif;
  font-size: 148px; line-height: 0.88; color: #00d8c0; letter-spacing: 0.02em; }
.player-name { font-family: 'Bebas Neue', Impact, sans-serif;
  font-size: 108px; line-height: 0.92; color: #ffffff;
  letter-spacing: 0.01em; margin-top: 26px; word-break: break-word; }
.player-name-at { font-family: 'DM Sans', sans-serif; font-size: 64px;
  font-weight: 700; color: #00d8c0; vertical-align: baseline;
  line-height: 1; margin-right: 4px; }
.handle-pill { display: inline-flex; align-items: center; gap: 12px;
  margin-top: 22px; padding: 10px 24px; border-radius: 999px;
  background: rgba(0,216,192,0.08); border: 1px solid rgba(0,216,192,0.22); }
.handle-at { font-size: 19px; font-weight: 700; color: #00d8c0; }
.handle-name { font-size: 19px; font-weight: 600; color: rgba(255,255,255,0.55); letter-spacing: 0.02em; }
.handle-divider { width: 1px; height: 17px; background: rgba(0,216,192,0.2); }
.handle-app { font-size: 14px; font-weight: 700; color: rgba(0,216,192,0.4);
  letter-spacing: 0.12em; text-transform: uppercase; }
.guru-badge-wrap { position: absolute; top: 14px; right: 110px; z-index: 3; }
.guru-badge-img { width: 380px; height: 380px; object-fit: contain;
  filter: drop-shadow(0 0 40px rgba(174,234,0,0.45)) drop-shadow(0 0 80px rgba(174,234,0,0.18)); }
.stat-row { position: relative; z-index: 2; flex-shrink: 0;
  display: flex; align-items: baseline; gap: 20px; padding: 30px 72px 0; }
.stat-pct { font-family: 'Bebas Neue', Impact, sans-serif;
  font-size: 96px; line-height: 1; color: #aeea00;
  text-shadow: 0 0 60px rgba(174,234,0,0.3); }
.stat-desc { font-size: 24px; font-weight: 600; color: rgba(255,255,255,0.32);
  letter-spacing: 0.03em; padding-bottom: 8px; }
.quiz-card { position: relative; z-index: 2; flex: 1;
  margin: 28px 64px 0; background: #0e1611;
  border-radius: 24px; border: 1px solid rgba(255,255,255,0.08);
  overflow: hidden; display: flex; flex-direction: column; }
.quiz-bar { display: flex; align-items: center; justify-content: space-between;
  padding: 18px 28px; border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02); flex-shrink: 0; }
.diff-pill { font-size: 13px; font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase; padding: 5px 14px; border-radius: 999px;
  background: rgba(255,71,87,0.12); color: #ff4757; border: 1px solid rgba(255,71,87,0.25); }
.cat-tag { font-size: 15px; font-weight: 500; color: rgba(255,255,255,0.28); }
.quiz-question { font-size: 38px; font-weight: 600; color: #ffffff;
  line-height: 1.35; padding: 28px 32px 20px; flex-shrink: 0; }
.quiz-options { display: flex; flex-direction: column; gap: 8px;
  padding: 0 20px 18px; flex: 1; justify-content: center; }
.opt { display: flex; align-items: center; gap: 18px;
  border-radius: 16px; padding: 14px 22px;
  border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
.opt.correct { background: rgba(174,234,0,0.1); border-color: #aeea00; }
.opt.faded { opacity: 0.38; }
.opt-lbl { width: 42px; height: 42px; border-radius: 11px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Bebas Neue', Impact, sans-serif; font-size: 22px;
  background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.45); }
.opt.correct .opt-lbl { background: #aeea00; color: #0a0f0a; }
.opt-text { font-size: 27px; font-weight: 500; color: rgba(255,255,255,0.45); line-height: 1.3; }
.opt.correct .opt-text { color: #aeea00; font-weight: 600; }
.footer { position: relative; z-index: 2; flex-shrink: 0;
  padding: 24px 64px 40px; margin-top: 20px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: space-between; }
.footer img { height: 48px; width: auto; mix-blend-mode: screen; }
.footer-tag { font-size: 17px; color: rgba(0,216,192,0.4);
  letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="card-date">${displayDate}</div>
  <div class="hero">
    <div class="guru-badge-wrap">
      <img class="guru-badge-img" src="${badgeUri}" alt="Question Guru Badge">
    </div>
    <div class="hero-pre">Today's</div>
    <div class="hero-title">Guru</div>
    <div class="player-name"><span class="player-name-at">@</span>${heroName(guruRawName)}</div>
    <div class="handle-pill">
      <span class="handle-at">@</span>
      <span class="handle-name">${guruUsername}</span>
      <div class="handle-divider"></div>
      <span class="handle-app">yourscore.app</span>
    </div>
  </div>
  <div class="stat-row">
    <div class="stat-pct">${correctPct}%</div>
    <div class="stat-desc">of players got this right</div>
  </div>
  <div class="quiz-card">
    <div class="quiz-bar">
      <span class="diff-pill">${diffLabel}</span>
      <span class="cat-tag">${category}</span>
    </div>
    <div class="quiz-question">${question}</div>
    <div class="quiz-options">
${optionsHtml}
    </div>
  </div>
  <div class="footer">
    <img src="${logoUri}" alt="YourScore">
    <div class="footer-tag">yourscore.app · Daily</div>
  </div>
</div>
</body>
</html>`;

// ── 4. Render PNG ────────────────────────────────────────────────────────────
const outDir = join(ROOT, "scripts/data");
mkdirSync(outDir, { recursive: true });
const htmlPath = join(outDir, `guru-card-${ukToday}.html`);
const pngPath  = join(outDir, `guru-card-${ukToday}.png`);
const jsonPath = join(outDir, `guru-${ukToday}.json`);

writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page    = await browser.newPage();
await page.setViewportSize({ width: 1080, height: 1350 });
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
await page.screenshot({ path: pngPath, fullPage: false });
await browser.close();
unlinkSync(htmlPath);

// ── 5. Save metadata ─────────────────────────────────────────────────────────
const meta = {
  date: ukToday, displayDate, pngPath,
  guru: { userId: guruUserId, name: guruRawName, username: guruUsername, email: guruEmail, wcPlayer: row.guru_wc_player === true, gatePct: row.guru_gate_pct != null ? Number(row.guru_gate_pct) : null },
  question: { text: question, correctAnswer: options[answer] ?? options[answer?.toLowerCase()], correctLetter: answer, correctPct: Number(correctPct), category, difficulty },
};
writeFileSync(jsonPath, JSON.stringify(meta, null, 2));

console.log(pngPath);
