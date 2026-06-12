/**
 * audit-wc2026-integrity.mjs
 *
 * READ-ONLY integrity audit for the WC2026 £100 prize leaderboard.
 *
 * Why this exists: quiz answers are currently readable by any client that
 * holds the public anon key (questions/quiz_packs have public SELECT policies,
 * and the pack payload ships answers for instant feedback). Server-side
 * grading stops score *forgery*, but a scripted player who pre-reads the
 * answers can still post legitimate-looking perfect, fast attempts. The
 * structural fix (server-held answers + per-answer grading) is queued for
 * after the World Cup traffic peak — until then, RUN THIS BEFORE PAYING ANY
 * PRIZE. Every attempt stores a per-question timing log that bots can't
 * plausibly fake without looking exactly like what this script flags.
 *
 * What it flags, per top-N leaderboard user:
 *   SPEED    — accuracy ≥ 90% with median answer time under 1.2s (reading the
 *              question alone takes longer)
 *   FLOOR    — 3+ answers under 400ms in one attempt (sub-human taps)
 *   UNIFORM  — perfect attempt whose answer-time spread is implausibly tight
 *              (bots pace evenly; humans don't)
 *   FRESH    — account created <24h before its first series attempt AND
 *              flagged on any of the above (burner accounts)
 *
 * Flags are evidence to eyeball, not verdicts — print includes the raw
 * timing rows so a human makes the call.
 *
 * Usage:
 *   node --env-file=.env.local scripts/audit-wc2026-integrity.mjs           # top 20
 *   TOP=50 node --env-file=.env.local scripts/audit-wc2026-integrity.mjs    # top 50
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://mznvuswzgkaupvaqznkm.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOP = Number(process.env.TOP ?? 20);

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required — run with --env-file=.env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const stddev = (xs) => {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

// 1. Series packs (same filter as /api/leaderboard/wc2026).
const { data: packs, error: packErr } = await sb
  .from("quiz_packs")
  .select("id, name, metadata")
  .eq("status", "published")
  .filter("metadata->>series", "eq", "wc2026");
if (packErr) throw packErr;
const packIds = (packs ?? []).map((p) => p.id);
const packName = new Map((packs ?? []).map((p) => [p.id, p.name]));
if (!packIds.length) {
  console.log("No wc2026 series packs found.");
  process.exit(0);
}

// 2. All attempts on those packs, with the per-question timing log.
const { data: attempts, error: attErr } = await sb
  .from("quiz_attempts")
  .select("user_id, pack_id, score, max_score, correct_count, answers, completed_at")
  .in("pack_id", packIds);
if (attErr) throw attErr;

// 3. Rank users by total score (best attempt per pack), like the public board.
const best = new Map(); // user -> pack -> attempt
for (const a of attempts ?? []) {
  const m = best.get(a.user_id) ?? new Map();
  const prev = m.get(a.pack_id);
  if (!prev || a.score > prev.score) m.set(a.pack_id, a);
  best.set(a.user_id, m);
}
const totals = [...best.entries()]
  .map(([uid, m]) => ({ uid, total: [...m.values()].reduce((s, a) => s + a.score, 0), attempts: [...m.values()] }))
  .sort((a, b) => b.total - a.total)
  .slice(0, TOP);

// 4. Profiles for names + account age.
const ids = totals.map((t) => t.uid);
const { data: profiles } = await sb.from("profiles").select("id, display_name, created_at").in("id", ids);
const prof = new Map((profiles ?? []).map((p) => [p.id, p]));

let flaggedUsers = 0;
for (const [rank, t] of totals.entries()) {
  const p = prof.get(t.uid);
  const flags = [];
  const details = [];

  for (const a of t.attempts) {
    const log = Array.isArray(a.answers) ? a.answers : [];
    if (!log.length) continue;
    const times = log.map((r) => r.elapsed_ms).filter((x) => Number.isFinite(x));
    const acc = a.correct_count / Math.max(1, log.length);
    const med = median(times);
    const sd = stddev(times);
    const under400 = times.filter((x) => x < 400).length;
    const perfect = a.correct_count === log.length;

    const attemptFlags = [];
    if (acc >= 0.9 && med < 1200) attemptFlags.push("SPEED");
    if (under400 >= 3) attemptFlags.push("FLOOR");
    if (perfect && times.length >= 5 && sd < 250) attemptFlags.push("UNIFORM");

    if (attemptFlags.length) {
      flags.push(...attemptFlags);
      details.push(
        `    ${packName.get(a.pack_id) ?? a.pack_id}: ${a.correct_count}/${log.length} correct, ` +
        `median ${Math.round(med)}ms, sd ${Math.round(sd)}ms, <400ms×${under400} [${attemptFlags.join(",")}]\n` +
        `      times: ${times.map((x) => Math.round(x)).join(", ")}`
      );
    }
  }

  if (flags.length && p?.created_at) {
    const firstAttempt = Math.min(...t.attempts.map((a) => Date.parse(a.completed_at)));
    if (firstAttempt - Date.parse(p.created_at) < 24 * 3600 * 1000) flags.push("FRESH");
  }

  const label = `#${rank + 1} ${p?.display_name ?? t.uid} — ${t.total} pts over ${t.attempts.length} pack(s)`;
  if (flags.length) {
    flaggedUsers += 1;
    console.log(`\n⚠️  ${label}  [${[...new Set(flags)].join(", ")}]`);
    details.forEach((d) => console.log(d));
  } else {
    console.log(`✓  ${label}`);
  }
}

console.log(
  `\n${flaggedUsers === 0 ? "No integrity flags in the top " + totals.length + "." :
    flaggedUsers + " of top " + totals.length + " flagged — review the timing rows above before any payout."}`
);
