/**
 * Find and retire duplicate questions in the question bank.
 *
 * The health checker caught the same question dealt twice in one quiz: id-based
 * dedup (user_question_history) can't stop two rows with identical TEXT from
 * being served together. This sweeps the ENTIRE active bank (paginated — the
 * earlier scan was silently capped at Supabase's 1,000-row default) and groups:
 *
 *   1. EXACT duplicates — same entity + same normalized text (lowercase,
 *      punctuation stripped, whitespace collapsed). Same normalization as
 *      scripts/health/checks/experience.mjs.
 *   2. NEAR duplicates — same entity + same normalized correct-answer text +
 *      IDENTICAL digit tokens (a question about the 2009-10 season is never a
 *      duplicate of one about 2010-11) + content-token Jaccard ≥ threshold
 *      (default 0.75, after synonym folding: ground=stadium, campaign=season…).
 *      Catches paraphrases like "Who holds the record for most appearances for
 *      X?" vs "Which player has made the most appearances for X?".
 *      Borderline pairs (Jaccard 0.5–threshold) are REPORTED for review but
 *      never auto-retired — precision beats recall when the action is retire.
 *
 * Within each group all but the "best" copy are retired (status='retired').
 * Best = data-grounded source first, then most-answered, then oldest.
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
 *                        SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/dedupe-questions.mjs                    # DRY RUN (report only)
 *   node scripts/dedupe-questions.mjs --commit           # retire duplicates
 *   node scripts/dedupe-questions.mjs --exact-only       # skip near-dup pass
 *   node scripts/dedupe-questions.mjs --threshold 0.6    # stricter near-dups
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const EXACT_ONLY = args.includes("--exact-only");
const thresholdIdx = args.indexOf("--threshold");
const THRESHOLD = thresholdIdx !== -1 ? Number(args[thresholdIdx + 1]) : 0.75;
const REVIEW_FLOOR = 0.5; // below THRESHOLD but above this → report only, never retire

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Same normalization as the health checker's duplicate detection.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

// Words that carry no distinguishing signal between two questions about the
// same entity — Jaccard is computed on what's left. Includes question
// boilerplate ("who holds the record for…" vs "which player has made…").
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "in", "on", "at", "to", "is", "was", "are", "were",
  "who", "which", "what", "whom", "whose", "did", "does", "do", "has", "have", "had",
  "player", "players", "club", "clubs", "team", "teams", "and", "or", "by", "with",
  "their", "his", "her", "its", "this", "that", "as", "from",
  "hold", "holds", "held", "record", "made", "make", "makes", "ever", "current",
  "currently", "total", "during", "name",
]);

// Fold interchangeable phrasings onto one token so "home ground" matches
// "home stadium" and "points collected" matches "points earned".
const SYNONYMS = new Map(Object.entries({
  ground: "stadium",
  campaign: "season",
  accumulate: "get", accumulated: "get",
  collect: "get", collected: "get",
  earn: "get", earned: "get",
  gain: "get", gained: "get",
  win: "won", wins: "won",
  title: "titles", trophy: "titles", trophies: "titles",
  founded: "founded", formed: "founded", established: "founded",
  netted: "scored", net: "scored",
}));

const tokens = (s) =>
  new Set(
    norm(s)
      .split(" ")
      .filter((t) => t && !STOPWORDS.has(t))
      .map((t) => SYNONYMS.get(t) ?? t)
  );

// Digit-bearing tokens (years, seasons, counts). Two questions whose digit
// tokens differ ask about different things — never merge them.
const digitTokens = (toks) => [...toks].filter((t) => /\d/.test(t)).sort().join("|");

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Normalized text of the correct answer (options is {A..D} jsonb, answer is a letter). */
function answerText(q) {
  const opts = q.options ?? {};
  return norm(opts[q.answer] ?? "");
}

// "Best" copy of a group: keep the one custom packs can still use
// (generate-custom filters on source='data-grounded'), then the one with the
// most engagement stats, then the oldest (most likely already in user history).
function rankBest(a, b) {
  const aGrounded = a.source === "data-grounded" ? 0 : 1;
  const bGrounded = b.source === "data-grounded" ? 0 : 1;
  if (aGrounded !== bGrounded) return aGrounded - bGrounded;
  if (a.times_answered !== b.times_answered) return b.times_answered - a.times_answered;
  return new Date(a.created_at) - new Date(b.created_at);
}

// ── Fetch ALL active rows (paginated past the 1,000-row default) ──────────────
async function fetchAllActive() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("questions")
      .select("id, entity, entity_type, question, options, answer, difficulty, era, status, source, times_answered, times_correct, created_at")
      .eq("status", "active")
      // Paginate on the unique id — created_at has ties from bulk inserts,
      // which makes range() repeat/skip rows across page boundaries.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  // Belt and braces: a row fetched twice would end up both kept and retired.
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
}

// ── Group duplicates within one entity ────────────────────────────────────────
// Union-find so near-dup chains (A~B, B~C) collapse into one group.
function groupEntity(questions) {
  const parent = questions.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { parent[find(i)] = find(j); };

  // Pass 1: exact normalized text.
  const byText = new Map();
  questions.forEach((q, i) => {
    const key = norm(q.question);
    if (!key) return;
    if (byText.has(key)) union(i, byText.get(key));
    else byText.set(key, i);
  });

  // Pass 2: near-dups — same correct answer, identical digit tokens, and
  // near-identical content tokens. Borderline similarity goes to review only.
  const reviewPairs = [];
  if (!EXACT_ONLY) {
    const toks = questions.map((q) => tokens(q.question));
    const digits = toks.map(digitTokens);
    const ans = questions.map(answerText);
    for (let i = 0; i < questions.length; i++) {
      if (!ans[i]) continue;
      for (let j = i + 1; j < questions.length; j++) {
        if (ans[i] !== ans[j]) continue;
        if (digits[i] !== digits[j]) continue;
        if (find(i) === find(j)) continue;
        const sim = jaccard(toks[i], toks[j]);
        if (sim >= THRESHOLD) union(i, j);
        else if (sim >= REVIEW_FLOOR) reviewPairs.push([questions[i], questions[j], sim]);
      }
    }
  }

  const groups = new Map();
  questions.forEach((q, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(q);
  });
  return { groups: [...groups.values()].filter((g) => g.length > 1), reviewPairs };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const all = await fetchAllActive();
console.log(`Fetched ${all.length} active questions (full sweep, paginated).`);

const byEntity = new Map();
for (const q of all) {
  if (!byEntity.has(q.entity)) byEntity.set(q.entity, []);
  byEntity.get(q.entity).push(q);
}

let groupCount = 0;
const toRetire = [];
const allReviewPairs = [];

for (const [entity, qs] of [...byEntity.entries()].sort()) {
  const { groups, reviewPairs } = groupEntity(qs);
  for (const [a, b, sim] of reviewPairs) allReviewPairs.push([entity, a, b, sim]);
  if (groups.length === 0) continue;
  console.log(`\n━━ ${entity} — ${groups.length} duplicate group(s)`);
  for (const group of groups) {
    groupCount++;
    const sorted = [...group].sort(rankBest);
    const [keep, ...retire] = sorted;
    const exact = new Set(group.map((q) => norm(q.question))).size === 1;
    console.log(`  ${exact ? "[exact]" : "[near] "} KEEP   ${keep.id.slice(0, 8)} (${keep.source}, ${keep.difficulty}, answered ${keep.times_answered}x) "${keep.question}"`);
    for (const q of retire) {
      console.log(`          RETIRE ${q.id.slice(0, 8)} (${q.source}, ${q.difficulty}, answered ${q.times_answered}x) "${q.question}"`);
      toRetire.push(q.id);
    }
  }
}

if (allReviewPairs.length > 0) {
  console.log(`\n── ${allReviewPairs.length} borderline pair(s) for HUMAN REVIEW (not retired) ──`);
  for (const [entity, a, b, sim] of allReviewPairs) {
    console.log(`  [${sim.toFixed(2)}] ${entity}: "${a.question}" (${a.id.slice(0, 8)}) ~ "${b.question}" (${b.id.slice(0, 8)})`);
  }
}

console.log(`\n${groupCount} duplicate group(s), ${toRetire.length} question(s) to retire (of ${all.length} active).`);

if (toRetire.length === 0) process.exit(0);

if (!COMMIT) {
  console.log("DRY RUN — re-run with --commit to retire.");
  process.exit(0);
}

// Retire in chunks (PostgREST .in() has URL-length limits around a few hundred UUIDs).
for (let i = 0; i < toRetire.length; i += 100) {
  const chunk = toRetire.slice(i, i + 100);
  const { error } = await supabase.from("questions").update({ status: "retired" }).in("id", chunk);
  if (error) {
    console.error(`Failed retiring chunk at ${i}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Retired ${Math.min(i + 100, toRetire.length)}/${toRetire.length}`);
}
console.log("Done.");
