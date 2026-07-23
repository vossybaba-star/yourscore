#!/usr/bin/env node
/**
 * Build the Premier League quiz pool for 38-0's PRO draft.
 *
 * The WC gate bundles from content/daily-quizzes/ (a dated daily series). The PL gate has
 * no daily series — its source is the live `questions` bank, so this script snapshots an
 * approved slice of the bank into src/data/draft/pl-quiz.json, which the app imports at
 * build time (deploy-safe, no runtime DB reads, and the answers stay out of the client
 * bundle because src/lib/draft/pl-quiz.ts is server-only).
 *
 *   node --env-file=.env.local scripts/draft/build-pl-quiz.mjs
 *
 * ── SCOPE IS THE POINT OF THIS SCRIPT ────────────────────────────────────────
 * Founder review (2026-07-22): the first bundle read as club trivia — 274 of 357 questions
 * needed a specific club's internal history, so a Liverpool fan got asked about Aston
 * Villa's honours. A player must only ever be asked:
 *
 *   1. NEUTRAL questions — Premier League records, history and league-wide moments that
 *      any fan of any club can have a go at. Everyone gets these.
 *   2. Questions about THEIR OWN CLUB — the one they picked in the app (club_supporters).
 *
 * So every question is tagged `scope`. The classifier is deliberately mechanical:
 *   - entity_type "records" + a Premier League entity      → neutral
 *   - entity_type "club", text does NOT name its own club  → neutral (league-wide framing,
 *     e.g. "Which club was Harry Kane at when he won the Golden Boot?" — answerable by all)
 *   - entity_type "club", text DOES name its own club      → club-scoped to that entity
 *   - entity_type "national_team"                          → dropped, this is a PL gate
 *
 * That middle rule is what keeps the neutral pool viable: two thirds of it is club-filed
 * but league-wide in framing. Without it the neutral pool is 32 questions, not ~98.
 *
 * TWO ARTIFACTS, and the order matters:
 *   src/data/draft/pl-quiz.json      — what ships
 *   scripts/data/pl-quiz-review.md   — the same questions, split neutral vs per-club, for
 *                                      the founder to read and hand-cut BEFORE it ships
 *
 * The filters below are the *playability* control — tune here, never in the game code.
 * They cannot judge "reads badly to a neutral fan"; that is what the review pass is for.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_BUNDLE = path.join(root, "src", "data", "draft", "pl-quiz.json");
const OUT_COUNTS = path.join(root, "src", "data", "draft", "pl-quiz-clubs.json");
const OUT_REVIEW = path.join(root, "scripts", "data", "pl-quiz-review.md");
const OUT_CUT = path.join(root, "scripts", "data", "pl-quiz-cut-numeric.md");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars (run with --env-file=.env.local)");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Club-name aliasing ───────────────────────────────────────────────────────

/**
 * `club_supporters.club` and `questions.entity` are two independently-authored name
 * spaces, and three of them disagree. A silent mismatch here doesn't error — it just
 * means those fans never see a single question about their own club, which is exactly
 * the bug this whole change exists to fix. So the mapping is explicit.
 *
 * Checked against season 28083's 20 clubs: 17 match exactly, these 2 need mapping, and
 * "Coventry City" has NO entity in the bank at all — their fans get the neutral pool
 * only, which the draw handles without special-casing.
 */
const SUPPORTER_CLUB_TO_ENTITY = {
  "AFC Bournemouth": "Bournemouth",
  "Brighton & Hove Albion": "Brighton",
};

/** Aliases used to detect whether a question NAMES the club it's filed under. Missing an
 *  alias mis-files a club question as neutral, which is the failure that leaks other
 *  clubs' trivia into everyone's gate — so this list is generous on purpose. */
const ENTITY_MENTIONS = {
  "Manchester City": ["Manchester City", "Man City"],
  "Manchester United": ["Manchester United", "Man Utd", "Man United"],
  "Tottenham Hotspur": ["Tottenham", "Spurs"],
  "Newcastle United": ["Newcastle"],
  "West Ham United": ["West Ham"],
  "Leicester City": ["Leicester"],
  "Aston Villa": ["Aston Villa", "Villa"],
  "Blackburn Rovers": ["Blackburn"],
  "Nottingham Forest": ["Nottingham Forest", "Forest"],
  "Leeds United": ["Leeds"],
  "Wolverhampton Wanderers": ["Wolverhampton", "Wolves"],
  "Crystal Palace": ["Crystal Palace", "Palace"],
  "West Bromwich Albion": ["West Brom", "Albion"],
  "Sheffield United": ["Sheffield United", "Blades"],
  "Sheffield Wednesday": ["Sheffield Wednesday", "Owls"],
  "Bolton Wanderers": ["Bolton"],
  "Norwich City": ["Norwich"],
  "Wigan Athletic": ["Wigan"],
  "Stoke City": ["Stoke"],
  "Hull City": ["Hull"],
  "Ipswich Town": ["Ipswich"],
  "Coventry City": ["Coventry"],
  "Cardiff City": ["Cardiff"],
  "Swansea City": ["Swansea"],
  "Birmingham City": ["Birmingham"],
  "Charlton Athletic": ["Charlton"],
  "Queens Park Rangers": ["QPR", "Queens Park Rangers"],
};
const mentionsOwnClub = (row) =>
  (ENTITY_MENTIONS[row.entity] ?? [row.entity]).some((t) => row.question.includes(t));

// ── The approved slice ───────────────────────────────────────────────────────

/**
 * Rejected shapes. Deliberately SHORT: the founder's inclusion rule is "if it involves a
 * Premier League club, it's in" — exact tallies, cup competitions and pre-1992 all STAY.
 *
 * Finishing-position recall is the one shape that is verifiable but unplayable: nobody
 * casually remembers that Chelsea came 8th in 2009-10, and a 4-option field doesn't help.
 * NOTE the breadth — the bank phrases it at least nine ways, and a narrow regex silently
 * lets most through (which is exactly what happened on the first build of this bundle).
 */
const REJECT = [
  {
    why: "finishing-position recall",
    re: /(final|finishing|league)\s+(league\s+)?(position|finish)|(position|place)\s+did\s+.*\bfinish|finish(ed)?\s+(in\s+)?(which|what|where)\b|\bwhere\s+did\s+.*\bfinish|finish(ed)?\s+(the\s+.*)?season\s+in\s+(which|what)\s+position/i,
  },
  { why: "leaked prompt artifact", re: /according to the (facts|data)|per the facts/i },
];

const LETTERS = ["A", "B", "C", "D"];
const PAGE = 1000; // PostgREST caps a read at 1000 rows — always page, never assume one call.

// ── Fetch ────────────────────────────────────────────────────────────────────

const SELECT = "id, entity, entity_type, question, options, answer, difficulty, category, era, fact_key";

async function fetchAll(build) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(supabase.from("questions").select(SELECT))
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Which clubs can actually be supported right now — the club slice is pointless for any
 *  other club, since no player can ever be keyed to it. Derived the same way the app does
 *  it (halftime_releases home/away for the latest season), so the two never drift. */
async function supportableEntities() {
  const { data, error } = await supabase.from("halftime_releases").select("home, away, season_id");
  if (error) throw new Error(error.message);
  const season = Math.max(...(data ?? []).map((r) => r.season_id).filter((s) => s != null));
  const clubs = new Set();
  for (const r of data ?? []) {
    if (r.season_id !== season) continue;
    clubs.add(r.home);
    clubs.add(r.away);
  }
  const mapped = new Map(); // bank entity -> supporter-facing club name
  for (const c of clubs) mapped.set(SUPPORTER_CLUB_TO_ENTITY[c] ?? c, c);
  return { season, mapped };
}

// ── Build ────────────────────────────────────────────────────────────────────

const { season, mapped: supportable } = await supportableEntities();

const rows = await fetchAll((q) =>
  q.eq("status", "active").eq("source", "data-grounded")
    .in("difficulty", ["easy", "medium"])
    .in("entity_type", ["club", "records"]),
);

const stats = { fetched: rows.length, rejected: {}, malformed: 0, ambiguous: 0, numeric: 0, dupText: 0, dupFact: 0, unsupportedClub: 0, nonPlRecords: 0 };
/** Everything the all-numeric rule removed, written out so the founder can restore the
 *  iconic ones by hand — see OUT_CUT. */
const cutNumeric = [];

const seenText = new Set();
const seenFact = new Set();
const pool = [];

for (const row of rows) {
  // Records that aren't Premier League records (Champions League, World Cup) aren't a PL gate.
  if (row.entity_type === "records" && !/premier league/i.test(row.entity)) { stats.nonPlRecords++; continue; }

  const bad = REJECT.find((r) => r.re.test(row.question));
  if (bad) { stats.rejected[bad.why] = (stats.rejected[bad.why] ?? 0) + 1; continue; }

  // Shape check — the bundle must be A–D with a valid answer letter or the game can't serve it.
  const opts = row.options ?? {};
  const options = LETTERS.map((L) => opts[L]);
  if (!row.question || options.some((v) => typeof v !== "string" || !v.trim()) || !LETTERS.includes(row.answer)) {
    stats.malformed++; continue;
  }

  // AMBIGUOUS ANSWERS. A few bank rows have an answer that is really two answers jammed
  // together — "The Villans The Lions", "The Red Devils United". They read as a typo, and
  // worse, they make a distractor correct too, so the gate marks a right answer wrong.
  const answerText = opts[row.answer];
  const others = LETTERS.filter((L) => L !== row.answer).map((L) => opts[L]);
  if (
    others.some((o) => typeof o === "string" && o.length > 3 && o !== answerText && answerText.includes(o)) ||
    /^The .+ The .+$/.test(answerText)
  ) { stats.ambiguous++; continue; }

  // COIN FLIPS. If all four options are bare numbers they are, in practice, the same number
  // four times: "How many goals did Salah score in 2024-25?" [28/30/29/31]. You can know
  // Salah won the Golden Boot, know exactly how good he was, and still have no way to choose
  // 29 over 30. There is nothing to reason from, so it's a 1-in-4 guess.
  //
  // That matters more in Pro than in a normal quiz, because a wrong answer caps the pick at
  // 72 overall AND resets the streak. Being punished for a gap in your knowledge is the game;
  // being punished for failing to guess 30 instead of 29 is not, and it directly contradicts
  // the mode's premise that the more football you know, the stronger your XI.
  //
  // This removes ~38% of the candidates, and it DOES take good questions with it — Forest's
  // two European Cups [2/1/3/0] is iconic and genuinely knowable, yet structurally identical
  // to Man Utd's 13 FA Cups [11/15/12/13], which is not. No filter can tell those apart; the
  // difference is whether the fact is famous. So the cut errs safe and every removed question
  // is written to pl-quiz-cut-numeric.md for hand-restoring.
  //
  // Scorelines ("2-2") and anything with a unit survive — the hyphen/letters mean they aren't
  // bare numbers, and they're recalled as events rather than tallies.
  if (options.every((o) => /^\d[\d,]*$/.test(String(o).trim()))) {
    stats.numeric++;
    cutNumeric.push({ q: row.question.trim(), options, answer: opts[row.answer], entity: row.entity });
    continue;
  }

  // ── SCOPE ──
  const isNeutral = row.entity_type === "records" || !mentionsOwnClub(row);
  const scope = isNeutral ? "neutral" : "club";

  // A club-scoped question about a club nobody can support can never be served. Drop it —
  // it would otherwise bloat the bundle the server has to carry for nothing.
  if (scope === "club" && !supportable.has(row.entity)) { stats.unsupportedClub++; continue; }

  // Dedupe on BOTH axes. Text alone misses two questions written off one fact (migration 81
  // — they spoil each other). fact_key alone is a no-op on legacy rows, where it's NULL.
  const textKey = row.question.trim().toLowerCase();
  if (seenText.has(textKey)) { stats.dupText++; continue; }
  if (row.fact_key && seenFact.has(row.fact_key)) { stats.dupFact++; continue; }
  seenText.add(textKey);
  if (row.fact_key) seenFact.add(row.fact_key);

  pool.push({
    id: row.id,
    q: row.question.trim(),
    options,                             // canonical A,B,C,D — the app re-shuffles per serve
    answer: LETTERS.indexOf(row.answer),
    difficulty: row.difficulty ?? "medium",
    category: row.category ?? "general",
    scope,
    // Only meaningful for scope "club": which club's fans may be asked this.
    club: scope === "club" ? row.entity : null,
  });
}

// ── Assertions (a bad bundle must fail the build, not ship quietly) ──────────

const neutral = pool.filter((q) => q.scope === "neutral");
if (neutral.length < 50) throw new Error(`Only ${neutral.length} neutral questions — every player sees these; too thin to ship`);
for (const q of pool) {
  if (q.options.length !== 4) throw new Error(`Question ${q.id} has ${q.options.length} options, expected 4`);
  if (!(q.answer >= 0 && q.answer < 4)) throw new Error(`Question ${q.id} has an out-of-range answer index`);
  if (q.scope === "club" && !q.club) throw new Error(`Question ${q.id} is club-scoped with no club`);
  if (q.scope === "neutral" && q.club) throw new Error(`Question ${q.id} is neutral but carries a club`);
}

// ── Write ────────────────────────────────────────────────────────────────────

const byClub = new Map();
for (const q of pool) {
  if (q.scope !== "club") continue;
  if (!byClub.has(q.club)) byClub.set(q.club, []);
  byClub.get(q.club).push(q);
}

fs.writeFileSync(
  OUT_BUNDLE,
  JSON.stringify({
    generatedFrom: "questions bank (status=active, source=data-grounded, difficulty in easy|medium, entity_type in club|records)",
    seasonId: season,
    // supporter-facing club name -> bank entity, so the server can resolve club_supporters
    // rows without re-deriving the alias map.
    clubAliases: SUPPORTER_CLUB_TO_ENTITY,
    count: pool.length,
    neutralCount: neutral.length,
    questions: pool,
  }, null, 2) + "\n",
);

/**
 * Per-club counts, keyed by the SUPPORTER-facing club name (what the picker shows), so the
 * client can use it without re-deriving the alias map.
 *
 * A separate file because pl-quiz.json carries every ANSWER and so is server-only. The UI
 * needs to know which clubs Pro can actually ask about — a UX walk found the picker offering
 * all 20 while Coventry had 0 questions, Ipswich 0 and Hull 1, so fans of those clubs were
 * promised "Pro asks about your team" and got nothing. Counts alone leak nothing.
 */
const countsBySupporterName = {};
for (const [entity, supporterName] of supportable) {
  countsBySupporterName[supporterName] = (byClub.get(entity) ?? []).length;
}
fs.writeFileSync(OUT_COUNTS, JSON.stringify({ seasonId: season, neutral: neutral.length, clubs: countsBySupporterName }, null, 2) + "\n");

const lines = [
  "# PL Pro gate — question bank review sheet",
  "",
  `**${pool.length} questions**: ${neutral.length} neutral (every player sees these) + ${pool.length - neutral.length} club-scoped across ${byClub.size} clubs.`,
  "Generated by `scripts/draft/build-pl-quiz.mjs`.",
  "",
  "Read for ONE thing: **could a fan who does NOT support this club have a fair go at it?**",
  "Anything in NEUTRAL must pass that test — those go to everybody. Club sections only ever",
  "reach that club's own fans, so they can be as parochial as you like. Answer marked `←`.",
  "",
  "## Neutral pool — shown to EVERY player",
  "",
];
const render = (q, i) => {
  lines.push(`**${i + 1}.** [${q.difficulty}/${q.category}] ${q.q}`);
  q.options.forEach((o, oi) => lines.push(`- ${LETTERS[oi]}. ${o}${oi === q.answer ? "  ←" : ""}`));
  lines.push("");
};
neutral.forEach(render);
lines.push("", "## Club-scoped — shown ONLY to that club's own fans", "");
for (const [club, qs] of Array.from(byClub).sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`### ${club} (${qs.length})`, "");
  qs.forEach(render);
}
fs.mkdirSync(path.dirname(OUT_REVIEW), { recursive: true });
fs.writeFileSync(OUT_REVIEW, lines.join("\n"));

// What the coin-flip rule removed, so nothing disappears silently.
const cut = [
  "# Cut by the coin-flip rule (all four options were bare numbers)",
  "",
  `**${cutNumeric.length} questions.** Every one of these gave four numbers in the same ballpark,`,
  "so knowing the football couldn't help you choose between them. In Pro a wrong answer costs",
  "you a player and your streak, so a guess is expensive.",
  "",
  "**A few of these are genuinely knowable** and worth restoring by hand: iconic totals like",
  "Forest's two European Cups or Villa's one. No filter can tell those from Manchester United's",
  "13 FA Cups, which nobody recalls exactly, because they look identical. Restoring means",
  "re-authoring the options with a non-numeric answer, or accepting the guess.",
  "",
];
for (const c of cutNumeric) {
  cut.push(`- **${c.q}**`, `  - [${c.options.join(" / ")}] answer: ${c.answer}  · ${c.entity}`, "");
}
fs.writeFileSync(OUT_CUT, cut.join("\n"));

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`Fetched (easy/medium, club+records): ${stats.fetched}`);
for (const [why, n] of Object.entries(stats.rejected)) console.log(`  − ${why}: ${n}`);
console.log(`  − non-PL records (CL/WC): ${stats.nonPlRecords}`);
if (stats.malformed) console.log(`  − malformed (options/answer): ${stats.malformed}`);
console.log(`  − ambiguous answer: ${stats.ambiguous}`);
console.log(`  − coin flip (all options bare numbers): ${stats.numeric}   → ${path.relative(root, OUT_CUT)}`);
console.log(`  − club nobody can support: ${stats.unsupportedClub}`);
console.log(`  − duplicate text: ${stats.dupText}`);
console.log(`  − duplicate fact_key: ${stats.dupFact}`);
console.log(`\nWrote ${pool.length} questions → ${path.relative(root, OUT_BUNDLE)}`);
console.log(`Review sheet          → ${path.relative(root, OUT_REVIEW)}`);
console.log(`\nNEUTRAL (every player): ${neutral.length}`);
console.log(`\nCLUB-SCOPED (season ${season}) — total pool a fan of each club draws from:`);
for (const [entity, supporterName] of Array.from(supportable).sort()) {
  const n = (byClub.get(entity) ?? []).length;
  const label = supporterName === entity ? entity : `${supporterName} → ${entity}`;
  console.log(`  ${String(neutral.length + n).padStart(4)}  (${String(n).padStart(3)} own)  ${label}`);
}
console.log("\n⚠️  Review the sheet before shipping — the filters can't judge playability.");
