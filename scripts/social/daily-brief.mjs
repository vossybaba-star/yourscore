/**
 * daily-brief.mjs — daily / weekly content intelligence brief.
 *
 * Queries game data (hardest questions, top scorers, rivalries, debate splits)
 * and surfaces ready-to-post social copy. Sends a Telegram brief for review.
 * Saves a JSON record to scripts/data/ for card generation later.
 *
 * Usage (from yourscore/):
 *   node --env-file=.env.local scripts/social/daily-brief.mjs            # daily
 *   node --env-file=.env.local scripts/social/daily-brief.mjs --weekly   # 7-day
 *   node --env-file=.env.local scripts/social/daily-brief.mjs --dry-run  # stdout only
 */

import { createClient } from "@supabase/supabase-js";
import { sendMessage } from "../tg.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const isWeekly = args.includes("--weekly");
const isDry = args.includes("--dry-run");

const windowMs = isWeekly ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
const windowLabel = isWeekly ? "last 7 days" : "last 24 hours";
const since = new Date(Date.now() - windowMs).toISOString();
const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London",
}).format(new Date());

function pct(n, d) { return d === 0 ? 0 : Math.round((n / d) * 100); }
function fmt(n) { return n.toLocaleString("en-GB"); }

// ── 1. Hardest questions (derived from quiz_attempts.answers jsonb) ──────────
// The solo-complete route stores per-question results in attempts.answers as
// [{idx, correct, selected, elapsed_ms, points}]. We aggregate across all
// attempts of the most-played packs to find which questions trip people up.
async function fetchHardestQuestions() {
  // Step 1: find packs with enough attempts for statistical signal
  const { data: allAttempts } = await supa
    .from("quiz_attempts")
    .select("pack_id, answers")
    .not("answers", "is", null);

  if (!allAttempts?.length) return [];

  // Group by pack
  const byPack = {};
  for (const a of allAttempts) {
    if (!a.answers) continue;
    if (!byPack[a.pack_id]) byPack[a.pack_id] = [];
    byPack[a.pack_id].push(a.answers);
  }

  // Only packs with 10+ attempts (enough signal)
  const eligible = Object.entries(byPack)
    .filter(([, arr]) => arr.length >= 10)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3); // top 3 most-played packs

  if (!eligible.length) return [];

  const results = [];
  for (const [packId, attempts] of eligible) {
    // Aggregate correct/total per question index
    const byIdx = {};
    for (const answers of attempts) {
      for (const a of answers) {
        if (typeof a.idx !== "number") continue;
        if (!byIdx[a.idx]) byIdx[a.idx] = { correct: 0, total: 0 };
        byIdx[a.idx].total++;
        if (a.correct) byIdx[a.idx].correct++;
      }
    }

    // Fetch pack for question text
    const { data: pack } = await supa
      .from("quiz_packs")
      .select("name, questions")
      .eq("id", packId)
      .single();

    const packQs = Array.isArray(pack?.questions) ? pack.questions : [];
    const minAttempts = Math.min(5, Math.floor(attempts.length * 0.2));

    for (const [idxStr, stats] of Object.entries(byIdx)) {
      if (stats.total < minAttempts) continue;
      const idx = parseInt(idxStr);
      const q = packQs[idx];
      if (!q?.question) continue;
      results.push({
        question: q.question,
        entity: q.entity ?? "",
        pack: pack?.name ?? "",
        times_answered: stats.total,
        times_correct: stats.correct,
        correct_pct: pct(stats.correct, stats.total),
      });
    }
  }

  return results
    .sort((a, b) => a.correct_pct - b.correct_pct)
    .slice(0, 3);
}

// ── 2. Top scorers in window ─────────────────────────────────────────────────
async function fetchTopScorers() {
  const { data, error } = await supa
    .from("quiz_attempts")
    .select("user_id, score, profiles(display_name)")
    .gte("completed_at", since);

  if (error || !data?.length) return [];

  const byUser = {};
  for (const a of data) {
    if (!byUser[a.user_id]) {
      byUser[a.user_id] = { name: a.profiles?.display_name ?? "Unknown", score: 0, games: 0 };
    }
    byUser[a.user_id].score += a.score ?? 0;
    byUser[a.user_id].games++;
  }

  return Object.values(byUser)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ── 3. Global leaderboard (all-time) ─────────────────────────────────────────
async function fetchLeaderboard() {
  const { data, error } = await supa
    .from("yourscore_user_ratings")
    .select("display_name, overall_score, overall_rank, knowledge_score, wins")
    .order("overall_rank", { ascending: true })
    .limit(5);

  if (error || !data?.length) return [];
  return data;
}

// ── 4. Hot rivalries (h2h_challenges, last 7 days) ───────────────────────────
async function fetchRivalries() {
  const { data, error } = await supa
    .from("h2h_challenges")
    .select("challenger_id, challenger_name, challenger_score, opponent_id, opponent_score, created_at")
    .eq("status", "complete")
    .gte("created_at", since7d)
    .not("opponent_id", "is", null);

  if (error || !data?.length) return [];

  const pairMap = {};
  for (const c of data) {
    const [ua, ub] = [c.challenger_id, c.opponent_id].sort();
    const key = `${ua}:${ub}`;
    if (!pairMap[key]) {
      pairMap[key] = { user_a: ua, user_b: ub, matches: 0, a_wins: 0, last_played: c.created_at };
    }
    pairMap[key].matches++;
    if (c.created_at > pairMap[key].last_played) pairMap[key].last_played = c.created_at;
    const aIsChallenger = c.challenger_id === ua;
    const aScore = aIsChallenger ? c.challenger_score : c.opponent_score;
    const bScore = aIsChallenger ? c.opponent_score : c.challenger_score;
    if (aScore > bScore) pairMap[key].a_wins++;
  }

  const top = Object.values(pairMap)
    .filter((p) => p.matches >= 2)
    .sort((a, b) => b.matches - a.matches || b.last_played.localeCompare(a.last_played))
    .slice(0, 3);

  if (!top.length) return [];

  const userIds = [...new Set(top.flatMap((r) => [r.user_a, r.user_b]))];
  const { data: profiles } = await supa
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const byId = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name ?? "Unknown"]));

  return top.map((r) => ({
    name_a: byId[r.user_a] ?? "Player 1",
    name_b: byId[r.user_b] ?? "Player 2",
    matches: r.matches,
    a_wins: r.a_wins,
    b_wins: r.matches - r.a_wins,
  }));
}

// ── 5. Active debate split ───────────────────────────────────────────────────
async function fetchDebate() {
  const { data: debates } = await supa
    .from("debates")
    .select("id, question, options")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!debates?.length) return null;
  const debate = debates[0];

  const { data: votes } = await supa
    .from("debate_votes")
    .select("option_idx")
    .eq("debate_id", debate.id);

  if (!votes?.length) return null;

  const counts = {};
  for (const v of votes) counts[v.option_idx] = (counts[v.option_idx] ?? 0) + 1;
  const total = votes.length;
  const options = Array.isArray(debate.options) ? debate.options : JSON.parse(debate.options ?? "[]");

  return {
    question: debate.question,
    total,
    splits: options.map((opt, i) => ({
      label: opt,
      votes: counts[i] ?? 0,
      pct: pct(counts[i] ?? 0, total),
    })),
  };
}

// ── 6. Weekly macro stats ────────────────────────────────────────────────────
async function fetchWeeklyMacro() {
  const [newUsersRes, weeklyAttemptsRes, bestStreakRes] = await Promise.all([
    supa.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since7d),
    supa.from("quiz_attempts").select("pack_id").gte("completed_at", since7d),
    supa.from("room_scores").select("best_streak").order("best_streak", { ascending: false }).limit(1).gte("updated_at", since7d),
  ]);

  const newUsers = newUsersRes.count ?? 0;
  const weeklyAttempts = weeklyAttemptsRes.data ?? [];
  const totalGames = weeklyAttempts.length;

  // Most-played pack
  const packCounts = {};
  for (const a of weeklyAttempts) {
    packCounts[a.pack_id] = (packCounts[a.pack_id] ?? 0) + 1;
  }
  const topPackId = Object.entries(packCounts).sort(([, a], [, b]) => b - a)[0]?.[0];
  let topPackName = null;
  if (topPackId) {
    const { data: pack } = await supa.from("quiz_packs").select("name").eq("id", topPackId).single();
    topPackName = pack?.name ?? null;
  }

  const bestStreak = bestStreakRes.data?.[0]?.best_streak ?? 0;

  return { newUsers, totalGames, topPackName, topPackId, bestStreak };
}

// ── Format Telegram message ──────────────────────────────────────────────────
function buildMessage({ hardest, topScorers, leaderboard, rivalries, debate, weekly }) {
  const type = isWeekly ? "Weekly Brief" : "Daily Brief";
  const lines = [`📊 <b>YourScore ${type}</b> — ${dateLabel}`];

  // Section: Hardest questions
  if (hardest.length) {
    lines.push("\n─────────────────────────");
    lines.push("🧠 <b>HARDEST QUESTIONS</b>");
    lines.push("─────────────────────────");
    hardest.forEach((q, i) => {
      const miss = 100 - q.correct_pct;
      lines.push(`\n<b>${i + 1}.</b> "${q.question}"`);
      lines.push(`   Only <b>${q.correct_pct}% right</b> out of ${fmt(q.times_answered)} attempts${q.pack ? ` (${q.pack})` : ""}`);
      lines.push(`   <i>→ Post:</i> "Only ${miss}% of players got this. Can you? 🧠 yourscore.app"`);
    });
  }

  // Section: Top scorers
  if (topScorers.length) {
    lines.push("\n─────────────────────────");
    lines.push(`🏆 <b>TOP SCORERS</b> (${windowLabel})`);
    lines.push("─────────────────────────");
    topScorers.forEach((u, i) => {
      lines.push(`${i + 1}. <b>${u.name}</b> — ${fmt(u.score)} pts (${u.games} game${u.games !== 1 ? "s" : ""})`);
    });
    const names = topScorers.slice(0, 3).map((u) => u.name).join(", ");
    lines.push(`\n<i>→ Post:</i> "Running the leaderboard 🔥 ${names}. Can you top them? yourscore.app"`);
  }

  // Section: All-time leaderboard (weekly only)
  if (isWeekly && leaderboard.length) {
    lines.push("\n─────────────────────────");
    lines.push("🌍 <b>GLOBAL LEADERBOARD</b>");
    lines.push("─────────────────────────");
    leaderboard.forEach((u, i) => {
      lines.push(`${i + 1}. <b>${u.display_name}</b> — ${fmt(u.overall_score)} pts (${u.wins} wins)`);
    });
    const names = leaderboard.slice(0, 3).map((u) => u.display_name).join(", ");
    lines.push(`\n<i>→ Post:</i> "The leaderboard right now 📊 ${names} leading the way. Who's chasing them? yourscore.app"`);
  }

  // Section: Rivalries
  if (rivalries.length) {
    lines.push("\n─────────────────────────");
    lines.push("⚔️ <b>HOTTEST RIVALRIES</b> (last 7 days)");
    lines.push("─────────────────────────");
    rivalries.forEach((r) => {
      const leader = r.a_wins >= r.b_wins ? r.name_a : r.name_b;
      const leaderWins = Math.max(r.a_wins, r.b_wins);
      const trailerWins = Math.min(r.a_wins, r.b_wins);
      lines.push(`\n<b>${r.name_a} vs ${r.name_b}</b> — ${r.matches} games, ${leader} leads ${leaderWins}–${trailerWins}`);
      const trailing = leader === r.name_a ? r.name_b : r.name_a;
      lines.push(`<i>→ Post:</i> "${r.name_a} and ${r.name_b} have played ${r.matches} times this week. ${leader} up ${leaderWins}–${trailerWins}. ${trailing}, you alright? 😅"`);
    });
  }

  // Section: Debate
  if (debate) {
    lines.push("\n─────────────────────────");
    lines.push("🗳️ <b>DEBATE</b>");
    lines.push("─────────────────────────");
    lines.push(`"${debate.question}"`);
    debate.splits.forEach((s) => lines.push(`  ${s.label}: <b>${s.pct}%</b> (${fmt(s.votes)} votes)`));
    const topSplit = debate.splits.sort((a, b) => b.votes - a.votes)[0];
    lines.push(`\n<i>→ Post:</i> "The community voted 🗳️ ${topSplit.pct}% say '${topSplit.label}'. Do you agree? Drop your take 👇"`);
  }

  // Section: Weekly macro
  if (isWeekly && weekly) {
    lines.push("\n─────────────────────────");
    lines.push("📈 <b>WEEK IN NUMBERS</b>");
    lines.push("─────────────────────────");
    lines.push(`New players: <b>${fmt(weekly.newUsers)}</b>`);
    lines.push(`Games played: <b>${fmt(weekly.totalGames)}</b>`);
    if (weekly.topPackName) lines.push(`Most-played quiz: <b>${weekly.topPackName}</b>`);
    if (weekly.bestStreak) lines.push(`Best streak this week: <b>${weekly.bestStreak}</b>`);
    lines.push(`\n<i>→ Post:</i> "This week on YourScore: ${fmt(weekly.newUsers)} new players, ${fmt(weekly.totalGames)} games played${weekly.bestStreak ? `, best streak ${weekly.bestStreak}` : ""}. The community keeps growing 📈"`);
  }

  lines.push("\n─────────────────────────");
  lines.push("<i>Reply with which posts you want cards made for.</i>");

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`📊 YourScore ${isWeekly ? "Weekly" : "Daily"} Brief — ${dateLabel}${isDry ? " (dry-run)" : ""}`);
  console.log("Fetching data...\n");

  const [hardest, topScorers, leaderboard, rivalries, debate] = await Promise.all([
    fetchHardestQuestions(),
    fetchTopScorers(),
    fetchLeaderboard(),
    fetchRivalries(),
    fetchDebate(),
  ]);

  const weekly = isWeekly ? await fetchWeeklyMacro() : null;

  const data = { date: dateLabel, type: isWeekly ? "weekly" : "daily", hardest, topScorers, leaderboard, rivalries, debate, weekly };
  const message = buildMessage(data);

  console.log(message.replace(/<[^>]+>/g, ""));

  if (!isDry) {
    // Save JSON brief
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const outPath = path.join(__dir, "../../scripts/data", `brief-${dateStr}.json`);
    await fs.writeFile(outPath, JSON.stringify(data, null, 2));
    console.log(`\n💾 Saved: ${outPath}`);

    // Send to Telegram
    await sendMessage(message);
    console.log("📬 Telegram brief sent.");
  } else {
    console.log("\n(dry-run — Telegram not sent, JSON not saved)");
  }
}

run().catch((e) => { console.error("✗", e.message); process.exit(1); });
