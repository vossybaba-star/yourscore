#!/usr/bin/env node
/**
 * Build the Premier League quiz pool for 38-0's GATED draft (PL Mastermind).
 *
 * The WC gate bundles from content/daily-quizzes/ (a dated daily series). The PL gate has
 * no daily series — its source is the live `questions` bank, so this script snapshots an
 * approved slice of the bank into src/data/draft/pl-quiz.json, which the app imports at
 * build time (deploy-safe, no runtime DB reads, and the answers stay out of the client
 * bundle because src/lib/draft/pl-quiz.ts is server-only).
 *
 *   node --env-file=.env.local scripts/draft/build-pl-quiz.mjs
 *
 * TWO ARTIFACTS, and the order matters:
 *   src/data/draft/pl-quiz.json      — what ships
 *   scripts/data/pl-quiz-review.md   — the same questions, grouped by club, for the
 *                                      founder to read and hand-cut BEFORE it ships
 *
 * The filters below are the *neutrality control* — tune here, never in the game code.
 * They cannot catch "reads badly to a neutral fan"; that is what the review pass is for.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_BUNDLE = path.join(root, "src", "data", "draft", "pl-quiz.json");
const OUT_REVIEW = path.join(root, "scripts", "data", "pl-quiz-review.md");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars (run with --env-file=.env.local)");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── The approved slice ───────────────────────────────────────────────────────

/** Clubs with real Premier League history. No national teams, no European-competition
 *  entities — the gate is Premier League only (founder, 2026-07-21). */
const CLUBS = [
  "Arsenal", "Liverpool", "Manchester City", "Manchester United", "Chelsea",
  "Tottenham Hotspur", "Leicester City", "Newcastle United", "Everton",
  "Aston Villa", "West Ham United", "Blackburn Rovers", "Nottingham Forest", "Leeds United",
];

/** Categories the club-scoped questions use. */
const CLUB_CATEGORIES = ["history-honours", "modern-era", "legends", "records", "rivalries-derbies"];

/** The league-wide entity — and the reason this script queries TWICE. `Premier League
 *  Records` files its questions under its OWN categories, so the CLUB_CATEGORIES filter
 *  silently drops all 32 of them. They are the most on-brief questions in the whole bank
 *  (neutral, key-moment, no club allegiance required), so they get their own pass. */
const LEAGUE_ENTITY = "Premier League Records";

/**
 * Rejected shapes. Deliberately SHORT: the founder's inclusion rule is "if it involves a
 * Premier League club, it's in" — exact tallies, cup competitions and pre-1992 all STAY.
 *
 * Finishing-position recall is the one shape that is verifiable but unplayable: nobody
 * casually remembers that Chelsea came 8th in 2009-10, and a 4-option field doesn't help.
 */
// NOTE the breadth of the first pattern. The bank phrases this shape at least nine
// different ways ("What position did X finish in", "X finished in which position",
// "X finished where in", "What was X's finishing position", "What was X's league finish")
// and a narrow regex silently lets most of them through — which is exactly what happened
// on the first build of this bundle. Match on the finish/position pairing, not on one
// sentence shape.
const REJECT = [
  {
    why: "finishing-position recall",
    re: /(final|finishing|league)\s+(league\s+)?(position|finish)|(position|place)\s+did\s+.*\bfinish|finish(ed)?\s+(in\s+)?(which|what|where)\b|\bwhere\s+did\s+.*\bfinish|finish(ed)?\s+(the\s+.*)?season\s+in\s+(which|what)\s+position/i,
  },
  { why: "leaked prompt artifact", re: /according to the (facts|data)|per the facts/i },
];

/** Per-club cap. Arsenal alone has ~80 eligible rows; without this the gate reads as an
 *  Arsenal quiz to everyone else. */
const PER_CLUB_CAP = 40;

const LETTERS = ["A", "B", "C", "D"];
const PAGE = 1000; // PostgREST caps a read at 1000 rows — always page, never assume one call.

// ── Fetch ────────────────────────────────────────────────────────────────────

const SELECT = "id, entity, question, options, answer, difficulty, category, era, fact_key";

/** Page through a filtered read of `questions` until the bank is exhausted. */
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

const base = (q) => q.eq("status", "active").eq("source", "data-grounded").in("difficulty", ["easy", "medium"]);

// ── Build ────────────────────────────────────────────────────────────────────

const [clubRows, leagueRows] = await Promise.all([
  fetchAll((q) => base(q).in("entity", CLUBS).in("category", CLUB_CATEGORIES)),
  fetchAll((q) => base(q).eq("entity", LEAGUE_ENTITY)),
]);

const candidates = [...leagueRows, ...clubRows]; // league-wide first — they survive the cap
const stats = { candidates: candidates.length, rejected: {}, malformed: 0, ambiguous: 0, dupText: 0, dupFact: 0, capped: 0 };

const seenText = new Set();
const seenFact = new Set();
const perEntity = new Map();
const pool = [];

for (const row of candidates) {
  // Reject the unplayable shapes.
  const bad = REJECT.find((r) => r.re.test(row.question));
  if (bad) { stats.rejected[bad.why] = (stats.rejected[bad.why] ?? 0) + 1; continue; }

  // Shape check — the bundle must be A–D with a valid answer letter or the game can't serve it.
  const opts = row.options ?? {};
  const options = LETTERS.map((L) => opts[L]);
  if (!row.question || options.some((v) => typeof v !== "string" || !v.trim()) || !LETTERS.includes(row.answer)) {
    stats.malformed++; continue;
  }

  // AMBIGUOUS ANSWERS. A small number of bank rows have an answer string that is really
  // two answers jammed together — "The Villans The Lions", "The Red Devils United". They
  // read as a typo, and worse, they make a distractor ("The Lions", "United") correct too,
  // so the gate marks a right answer wrong. Two precise tests, not a guess:
  //   a) the answer contains another option verbatim
  //   b) the answer is two "The …"-led names concatenated
  const answerText = opts[row.answer];
  const others = LETTERS.filter((L) => L !== row.answer).map((L) => opts[L]);
  const ambiguous =
    others.some((o) => typeof o === "string" && o.length > 3 && o !== answerText && answerText.includes(o)) ||
    /^The .+ The .+$/.test(answerText);
  if (ambiguous) { stats.ambiguous++; continue; }

  // Dedupe on BOTH axes. Text alone misses two questions written off one fact (migration 81
  // — they spoil each other). fact_key alone is a no-op on legacy rows, where it's NULL.
  const textKey = row.question.trim().toLowerCase();
  if (seenText.has(textKey)) { stats.dupText++; continue; }
  if (row.fact_key && seenFact.has(row.fact_key)) { stats.dupFact++; continue; }

  // Per-club cap (the league-wide entity is exempt — it's the neutral core of the gate).
  const n = (perEntity.get(row.entity) ?? 0) + 1;
  if (row.entity !== LEAGUE_ENTITY && n > PER_CLUB_CAP) { stats.capped++; continue; }
  perEntity.set(row.entity, n);

  seenText.add(textKey);
  if (row.fact_key) seenFact.add(row.fact_key);

  pool.push({
    id: row.id,
    q: row.question.trim(),
    options,                             // canonical A,B,C,D — the app re-shuffles per serve
    answer: LETTERS.indexOf(row.answer),
    difficulty: row.difficulty ?? "medium",
    category: row.category ?? "general",
    entity: row.entity,
  });
}

// ── Assertions (a bad bundle must fail the build, not ship quietly) ──────────

if (pool.length === 0) throw new Error("Empty pool — check the filters or the bank");
for (const q of pool) {
  if (q.options.length !== 4) throw new Error(`Question ${q.id} has ${q.options.length} options, expected 4`);
  if (!(q.answer >= 0 && q.answer < 4)) throw new Error(`Question ${q.id} has an out-of-range answer index`);
}

// ── Write ────────────────────────────────────────────────────────────────────

fs.writeFileSync(
  OUT_BUNDLE,
  JSON.stringify({
    generatedFrom: "questions bank (status=active, source=data-grounded, difficulty in easy|medium)",
    entities: [LEAGUE_ENTITY, ...CLUBS],
    count: pool.length,
    questions: pool,
  }, null, 2) + "\n",
);

// Review sheet — grouped by club, answer marked, so the founder can read and cut.
const byEntity = new Map();
for (const q of pool) {
  if (!byEntity.has(q.entity)) byEntity.set(q.entity, []);
  byEntity.get(q.entity).push(q);
}
const order = [LEAGUE_ENTITY, ...CLUBS].filter((e) => byEntity.has(e));

const lines = [
  "# PL gated-draft question bank — review sheet",
  "",
  `**${pool.length} questions** across ${order.length} entities. Generated by \`scripts/draft/build-pl-quiz.mjs\`.`,
  "",
  "Read for ONE thing: **would a neutral football fan have a fair shot at this?**",
  "The script can filter shapes; it cannot judge that. Strike anything that reads as deep",
  "club trivia, needs context the wording doesn't give, or isn't really a Premier League",
  "question. Answer is marked `←`.",
  "",
  "| Entity | Questions |",
  "|---|---|",
  ...order.map((e) => `| ${e} | ${byEntity.get(e).length} |`),
  "",
];
for (const entity of order) {
  lines.push(`## ${entity} (${byEntity.get(entity).length})`, "");
  byEntity.get(entity).forEach((q, i) => {
    lines.push(`**${i + 1}.** [${q.difficulty}/${q.category}] ${q.q}`);
    q.options.forEach((o, oi) => lines.push(`- ${LETTERS[oi]}. ${o}${oi === q.answer ? "  ←" : ""}`));
    lines.push("");
  });
}
fs.mkdirSync(path.dirname(OUT_REVIEW), { recursive: true });
fs.writeFileSync(OUT_REVIEW, lines.join("\n"));

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`Candidates:          ${stats.candidates}`);
for (const [why, n] of Object.entries(stats.rejected)) console.log(`  − ${why}: ${n}`);
if (stats.malformed) console.log(`  − malformed (options/answer): ${stats.malformed}`);
console.log(`  − ambiguous answer (contains another option): ${stats.ambiguous}`);
console.log(`  − duplicate text: ${stats.dupText}`);
console.log(`  − duplicate fact_key: ${stats.dupFact}`);
console.log(`  − over per-club cap (${PER_CLUB_CAP}): ${stats.capped}`);
console.log(`\nWrote ${pool.length} questions → ${path.relative(root, OUT_BUNDLE)}`);
console.log(`Review sheet          → ${path.relative(root, OUT_REVIEW)}`);
console.log("\nPer entity:");
for (const e of order) console.log(`  ${String(byEntity.get(e).length).padStart(4)}  ${e}`);
console.log("\n⚠️  Review the sheet before shipping — the filters can't judge playability.");
