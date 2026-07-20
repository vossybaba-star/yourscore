/**
 * Fill RIVALRIES & DERBIES for all 20 current PL clubs — the one category that is empty for
 * every single club.
 *
 *   node --env-file=.env.local scripts/quiz-factory/run-rivalries.mjs            # plan, no spend
 *   node --env-file=.env.local scripts/quiz-factory/run-rivalries.mjs --commit   # run it
 *   node --env-file=.env.local scripts/quiz-factory/run-rivalries.mjs --commit --min 12
 *
 * Why this category and not a broader sweep: rivalries is 0/20 clubs, and unlike Modern Era it
 * has NO feed grounding — SportMonks knows league tables, not derbies — so it can never be
 * filled later by the cheap path. Everything else in the bank can wait; this can't be deferred
 * to a cheaper method because there isn't one.
 *
 * RESUME IS THE POINT. Each club is a real ~$1 of research, so the driver checks the bank first
 * and skips any club that already has enough. A crash, a drained key or a Ctrl-C costs you the
 * club in flight and nothing else — re-run the same command and it picks up where it stopped.
 * (Earlier runs in this project have died mid-sweep and repeated paid work; not again.)
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const CATEGORY = "rivalries-derbies";

/** The 20 current PL clubs, spelled EXACTLY as questions.entity already spells them. */
const CLUBS = [
  "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton & Hove Albion",
  "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham",
  "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United",
  "Nottingham Forest", "Sunderland", "Tottenham Hotspur", "West Ham United",
  "Wolverhampton Wanderers",
];

const has = (f) => process.argv.includes(f);
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };

const COMMIT = has("--commit");
/** A club with at least this many rivalries questions is considered done and skipped. */
const MIN = Number(arg("--min", 12));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);

/** How many rivalries questions each club already holds. */
async function held() {
  const counts = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("questions")
      .select("entity")
      .eq("status", "active").eq("entity_type", "club").eq("category", CATEGORY)
      .order("id").range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    for (const r of data ?? []) counts[r.entity] = (counts[r.entity] ?? 0) + 1;
    if (!data || data.length < 1000) break;
  }
  return counts;
}

const counts = await held();
const todo = CLUBS.filter((c) => (counts[c] ?? 0) < MIN);
const done = CLUBS.filter((c) => (counts[c] ?? 0) >= MIN);

console.log(`\n🏟  Rivalries & Derbies — ${CLUBS.length} PL clubs${COMMIT ? "" : "   (PLAN ONLY — nothing spent)"}\n`);
if (done.length) console.log(`   already have ≥${MIN}, skipping: ${done.map((c) => `${c} (${counts[c]})`).join(", ")}\n`);
console.log(`   to run: ${todo.length} club(s)`);
console.log(`   estimated: ~$${(todo.length * 1.0).toFixed(0)} (measured ~$1.00/club for this category)\n`);

if (!COMMIT) {
  for (const c of todo) console.log(`     · ${c}  (has ${counts[c] ?? 0})`);
  console.log(`\nPLAN ONLY — re-run with --commit to spend.\n`);
  process.exit(0);
}

// Full output to disk. A previous run was piped through `tail` and the gate pass-rate and
// difficulty-mix lines were lost off the top — the two numbers that most needed reading.
const LOG_DIR = join(process.cwd(), "scripts/data");
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG = join(LOG_DIR, `rivalries-run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
console.log(`📝 full output → ${LOG}\n`);

/** Run one club to completion, streaming its output to both console and the log. */
function runClub(club) {
  return new Promise((resolve) => {
    const child = spawn("node", [
      "--env-file=.env.local", "scripts/quiz-factory/run-bank.mjs",
      "--club", club, "--cat", CATEGORY, "--commit",
    ], { cwd: process.cwd() });

    const tee = (buf) => { process.stdout.write(buf); appendFileSync(LOG, buf); };
    child.stdout.on("data", tee);
    child.stderr.on("data", tee);
    child.on("close", (code) => resolve(code));
  });
}

const results = [];
for (const [i, club] of todo.entries()) {
  console.log(`\n${"═".repeat(64)}\n[${i + 1}/${todo.length}] ${club}\n${"═".repeat(64)}`);
  appendFileSync(LOG, `\n\n===== [${i + 1}/${todo.length}] ${club} =====\n`);
  const code = await runClub(club);
  results.push({ club, code });

  // Exit 2 is CreditExhausted. Every remaining club would fail the same way and a half-run
  // sweep is the thing we're trying to avoid — stop and say so.
  if (code === 2) {
    console.error(`\n⛔ ANTHROPIC OUT OF CREDIT — stopping after ${i + 1}/${todo.length} clubs.`);
    console.error(`   Top up, then re-run the same command: finished clubs are skipped automatically.\n`);
    break;
  }
  if (code !== 0) console.error(`   ⚠️  ${club} exited ${code} — continuing with the next club.`);
}

// ── What actually landed ────────────────────────────────────────────────────────
const after = await held();
console.log(`\n${"─".repeat(64)}\nRIVALRIES — final state\n`);
let filled = 0;
for (const c of CLUBS) {
  const n = after[c] ?? 0;
  if (n >= MIN) filled++;
  const was = counts[c] ?? 0;
  console.log(`  ${c.padEnd(26)} ${String(n).padStart(3)}${n !== was ? `  (+${n - was})` : ""}`);
}
console.log(`\n  ${filled}/${CLUBS.length} clubs now have ≥${MIN} rivalries questions`);
const failed = results.filter((r) => r.code !== 0);
if (failed.length) console.log(`  ⚠️  ${failed.length} club(s) failed: ${failed.map((f) => `${f.club}(${f.code})`).join(", ")}`);
console.log(`\n  full log: ${LOG}\n`);
