/**
 * hard-question-post.mjs — the daily "Only N% got this right" reply-bait tweet.
 *
 * Picks the hardest recently-answered quiz question (last 14 days, ≥30 attempts),
 * EXCLUDING anything in a pack created in the last 24h (never leak today's live
 * quiz) and anything already used (scripts/data/hard-question-used.json). Renders
 * an in-app-style question card (question-card-gen.mjs, no answer shown) and adds
 * the tweet + card to the X approval queue — it posts NOTHING itself; the founder
 * approves in Studio/Telegram and the drip sends it.
 *
 * Usage: node --env-file=.env.local scripts/social/hard-question-post.mjs [--dry]
 * Scheduled: 11:30 UK daily via cron.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendMessage } from "../tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const DRY = process.argv.includes("--dry");
const USED = join(ROOT, "scripts/data/hard-question-used.json");
const PROJECT_REF = "mznvuswzgkaupvaqznkm";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) throw new Error("Missing SUPABASE_ACCESS_TOKEN");

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SQL failed: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// Hardest questions over the last 14 days across ALL quiz surfaces (packs + lobby games).
// The NOT IN clause keeps anything from a pack created in the last 24h out of
// reach, so today's live quiz can never be spoiled.
const rows = await sql(`
  WITH per_answer AS (
    -- Quiz packs at /play
    SELECT qp.questions->((a_elem->>'idx')::int) AS q, (a_elem->>'correct')::bool AS correct
    FROM quiz_attempts qa
    JOIN quiz_packs qp ON qp.id = qa.pack_id
    CROSS JOIN LATERAL jsonb_array_elements(qa.answers) a_elem
    WHERE qa.completed_at >= now() - interval '14 days'
    UNION ALL
    -- Lobby games (answers -> question_events -> rooms -> quiz_packs)
    SELECT qp.questions->qe.sequence_number AS q, a.is_correct
    FROM answers a
    JOIN question_events qe ON a.question_event_id = qe.id
    JOIN rooms r ON qe.room_id = r.id
    JOIN quiz_packs qp ON r.pack_id = qp.id
    WHERE a.answered_at >= now() - interval '14 days'
    UNION ALL
    -- WC Mastermind gate answers (draft_wc_runs.quiz_answers, migration 76 — pack-shaped)
    SELECT (elem - 'selected' - 'correct') AS q, (elem->>'correct')::bool
    FROM draft_wc_runs r
    CROSS JOIN LATERAL jsonb_array_elements(r.quiz_answers) elem
    WHERE r.quiz_answers IS NOT NULL AND r.created_at >= now() - interval '14 days'
  ),
  stats AS (
    SELECT q->>'question' AS question, q->'options' AS options,
           q->>'category' AS category, q->>'difficulty' AS difficulty,
           COUNT(*) AS attempts,
           ROUND(100.0 * SUM(CASE WHEN correct THEN 1 ELSE 0 END) / COUNT(*), 0) AS correct_pct
    FROM per_answer WHERE q IS NOT NULL
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(*) >= 30
  )
  SELECT * FROM stats
  WHERE question NOT IN (
    SELECT jsonb_array_elements(questions)->>'question'
    FROM quiz_packs WHERE created_at >= now() - interval '1 day'
  )
  AND correct_pct <= 40
  ORDER BY correct_pct ASC, attempts DESC
  LIMIT 10;
`);

if (!rows?.length) { console.log("No hard-enough question found — skipping today."); process.exit(0); }

let used = [];
try { used = JSON.parse(readFileSync(USED, "utf8")); } catch {}
// Brand rule: football only — a question that name-drops American football
// (e.g. "home of the NFL's Chiefs") is fine in-app but off-brand as a tweet.
const AMERICAN = /\b(nfl|touchdown|quarterback|gridiron|super bowl|end zone)\b/i;
const pick = rows.find((r) => !used.includes(r.question) && !AMERICAN.test(r.question));
if (!pick) { console.log("All candidates used or brand-filtered — skipping today."); process.exit(0); }

const pct = String(Math.max(1, parseInt(pick.correct_pct, 10)));
const options = typeof pick.options === "string" ? JSON.parse(pick.options) : pick.options;

// ── render the card ───────────────────────────────────────────────────────────
const png = execFileSync("node", [
  "scripts/social/question-card-gen.mjs",
  "--question", pick.question,
  "--options", JSON.stringify(options),
  "--pct", pct,
  "--category", pick.category || "football",
  "--difficulty", pick.difficulty || "hard",
], { cwd: ROOT, encoding: "utf8" }).trim();

// ── tweet copy: pose the question, let the replies do the work. No answer. ────
const tweetText = `Only ${pct}% of you got this right 🤯

${pick.question}

Answers below. No googling.`;

if (DRY) { console.log(`--dry\n${tweetText}\ncard: ${png}`); process.exit(0); }

// ── into the approval queue (with the card attached) ─────────────────────────
const out = execFileSync("node", [
  "--env-file=.env.local", "scripts/x-queue.mjs", "add", tweetText, "--image", png,
], { cwd: ROOT, encoding: "utf8" }).trim();

used.push(pick.question);
writeFileSync(USED, JSON.stringify(used.slice(-200), null, 0));

await sendMessage(`🧩 <b>Hard-question tweet drafted</b> (${pct}% correct rate, ${pick.attempts} attempts)\n\n<i>${tweetText}</i>\n\nCard attached — approve it in Studio → Needs you.`);
console.log(`queued: ${out} · card ${png}`);
