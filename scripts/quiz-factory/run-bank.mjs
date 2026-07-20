/**
 * The CLUB QUESTION BANK filler (Ship 2). Fills `questions` — the reusable bank a fan's
 * club quiz is DRAWN from — not `quiz_packs`. No release date, no email, no push. Inventory.
 *
 *   node --env-file=.env.local scripts/quiz-factory/run-bank.mjs                       # PROJECT (no API, cost estimate only)
 *   node --env-file=.env.local scripts/quiz-factory/run-bank.mjs --club Arsenal --cat history-honours --dry-run
 *   node --env-file=.env.local scripts/quiz-factory/run-bank.mjs --club Arsenal --cat history-honours --commit
 *   node --env-file=.env.local scripts/quiz-factory/run-bank.mjs --club Arsenal --all --commit   # all 4 categories
 *
 * Pipeline per (club, category): authorBank (overgenerated, EASY-skewed) → THE GATE →
 * insert survivors into `questions` as source='data-grounded', status='active'.
 *
 * Modes:
 *   default / --project  → NO API calls. Prints the plan + a cost estimate. Spend nothing.
 *   --dry-run            → author + gate, print survivors, NO DB write (this DOES spend).
 *   --commit             → author + gate + write to the bank (spends).
 */

import { createClient } from "@supabase/supabase-js";
import { authorFromFacts } from "./author.mjs";
import { runGate } from "./verify.mjs";
import { researchClubFacts, sportmonksFacts, buildAuthorSheet, factsText as renderFacts, factsReviewText } from "./facts.mjs";
import { rateBatch } from "./difficulty.mjs";
import { clubFactSheet, factSheetText } from "../lib/sportmonks.mjs";
import { costReport, usage, CreditExhausted } from "../lib/anthropic.mjs";

// ── The 4 LOCKED categories ────────────────────────────────────────────────────
// The category KEY is the locked vocabulary written into questions.category and used by
// the club draw. The brief steers authoring. `source` documents where the facts come from
// (transparency the founder asked for). `sportmonks` marks categories that CAN be grounded
// in SportMonks data instead of web search — that's the cheap path, once it's wired in.
// `grounded: true` → author straight from the SportMonks fact sheet, no web search (the
// cheap path). Every category ALSO gets the fact sheet handed to the verifier, so any
// question the sheet covers (finishes, points, title wins, per-season top scorers) is
// confirmed for token cost only, whatever it was authored from.
export const CATEGORIES = {
  "history-honours": {
    label: "History & Honours",
    brief: "The club's trophies and honours. Lead with the ones fans actually remember — cup finals and title wins of the last 15-20 years (who they beat, who scored, which season), then the famous older triumphs and defining moments. Founding-era detail is a small garnish, not the meat: nobody's first quiz should be about 1886. Fixed historical facts that never change.",
    source: "SportMonks (PL titles + European finals) + web (FA/League Cup, founding)",
    grounded: false,      // domestic cups & founding year still need the web
    factCoverage: 0.6,    // PL titles, European finals and finishes all verify off the sheet now
  },
  "legends": {
    label: "Legends",
    brief: "The club's greatest players — record appearance-makers and goalscorers, iconic captains, cult heroes, all-time XI figures. Historical and verifiable.",
    source: "web + SportMonks (per-season top scorers from the fact sheet)",
    grounded: false,      // appearance records & all-time figures need the web
    factCoverage: 0.35,
  },
  "modern-era": {
    label: "Modern Era",
    brief: "The club from 2015 onwards — where they finished, points won, who their top scorer was, and their European campaigns and finals. Anchor EVERY question to a named season (e.g. 'in the 2019/20 season') so it never rots.",
    source: "SportMonks PL + European cups, 2015→ — fully grounded, no web search",
    grounded: true,       // the fact sheet IS the source — measured $0.12/14 questions
    factCoverage: 1,
  },
  // Replaced "European Nights" (2026-07-16). That category only works for 6 of 20 PL clubs:
  // Bournemouth, Brentford, Burnley and Sunderland have ZERO European campaigns since 2000,
  // and six more have one or two — you cannot build 75 questions from nothing. Even Arsenal
  // produced 0 easy questions, because their whole European record is three lost finals.
  // Rivalries is universal, and it's strongest exactly where Europe is weakest:
  // Sunderland–Newcastle, Palace–Brighton, Brentford–Fulham, Burnley–Blackburn.
  // (The European material isn't wasted — it feeds the cross-club "Champions League Records"
  // topic in build-your-own, where no club is left out.)
  "rivalries-derbies": {
    label: "Rivalries & Derbies",
    brief: "The club's rivalries — who their derby rivals are and why, famous derby results and moments, memorable head-to-heads. Every question must name the season/year and the competition, since derbies are played across several.",
    source: "web (derby history, head-to-heads)",
    grounded: false,      // head-to-head results aren't in the fact sheet
    factCoverage: 0.15,   // league placings around a derby season verify off the sheet
  },
};

// ── Measured cost model ─────────────────────────────────────────────────────────
// From the live 2-pack run (web) and the Arsenal × Modern-Era grounded run (2026-07-16):
//   web author       ~$1.02 per call         verify (web search)   ~$0.11 / question
//   grounded author  ~$0.10 per call (no web) verify (fact sheet)  ~$0.01 / question (no web)
// The SportMonks path replaces per-question web search with a check against data we already
// hold. Measured: Arsenal Modern-Era = $0.12 for the whole category vs a ~$4.32 web estimate.
// FACTS-FIRST changes the shape of this. Web search now happens ONCE per category (the
// research pass), not once per question twice over (author + verify). Everything after the
// research pass is token-only.
const COST = {
  researchPerCall: 0.40,   // one web-search research call per category (~10-15 searches)
  authorPerCall: 0.10,     // authoring from the sheet — no web
  checkPerQ: 0.01,         // consistency check vs the sheet — no web
  ratePerBatch: 0.02,      // one batched difficulty rating call
};

/** Grounded categories (SportMonks covers them) skip the research call entirely. */
function categoryCost(cat, count) {
  const research = cat.factCoverage >= 1 ? 0 : COST.researchPerCall;
  return research + COST.authorPerCall + count * COST.checkPerQ + COST.ratePerBatch;
}

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : dflt;
};
const has = (flag) => process.argv.includes(flag);

const CLUB = arg("--club", null);
const CAT = arg("--cat", null);
const ALL = has("--all");
// 25, not 75. Founder's call (2026-07-17) after the Arsenal pilot, and the pilot earned it:
// 30 questions/category came back 7% easy — no better than the bank we're replacing. There
// simply aren't 30 famous facts per club per category; maybe ten. Ask for more and the
// researcher exhausts the famous material and digs into trivia (Senderos inheriting Adams's
// shirt number), which the rater then correctly calls hard. Depth and easiness fight, and
// depth wins. A smaller ask keeps us in the range where the famous material actually lives —
// the 16-question run hit 21% easy against the 30-question run's 7%.
const COUNT = Number(arg("--count", 25));
const FACT_COUNT = Number(arg("--facts", 25));  // facts to research first (ONE call, not one per question)
const SHOW_FACTS = has("--show-facts");         // print the sheet for review
const DRY = has("--dry-run");
const COMMIT = has("--commit");
const TOP_UP = has("--top-up");                 // second pass: avoid ground already covered
const PROJECT = !DRY && !COMMIT;                 // default mode = estimate only, no spend

const cats = ALL ? Object.keys(CATEGORIES) : CAT ? [CAT] : Object.keys(CATEGORIES);
for (const c of cats) if (!CATEGORIES[c]) { console.error(`Unknown category "${c}". Known: ${Object.keys(CATEGORIES).join(", ")}`); process.exit(1); }

// ── PROJECT mode: pure estimate, zero API calls ─────────────────────────────────
if (PROJECT) {
  console.log(`\n🔮 COST PROJECTION — no API calls, nothing spent.  (facts-first pipeline)\n`);
  console.log(`  gather facts → author from the sheet → cheap check → rate difficulty\n`);
  console.log(`Per (club × category), ${FACT_COUNT} facts → ${COUNT} questions authored:\n`);

  const OLD_WEB = 1.02 + COUNT * 0.11; // the old author-then-verify-each-question cost
  let total = 0;
  for (const key of Object.keys(CATEGORIES)) {
    const c = CATEGORIES[key];
    const cost = categoryCost(c, COUNT);
    total += cost;
    const tag = c.factCoverage >= 1 ? "SportMonks — no research call needed" : "one research call, then token-only";
    console.log(`  ${c.label.padEnd(22)} ~$${cost.toFixed(2)}   (${tag})`);
  }

  const clubs = 20;
  console.log(`\n  One club, all 4 categories:   ~$${total.toFixed(2)}   (was ~$${(OLD_WEB * 4).toFixed(2)} question-first)`);
  console.log(`  All ${clubs} PL clubs × 4 cats:      ~$${(total * clubs).toFixed(0)}     (was ~$${(OLD_WEB * 4 * clubs).toFixed(0)} question-first)`);
  console.log(`\n  Why: web search now happens ONCE per category (the research pass) instead of`);
  console.log(`  twice per question (author searches, then the verifier searches again).`);
  console.log(`  Facts are also reusable — one sheet serves several categories and themed packs.\n`);
  console.log(`To run one for real:  node --env-file=.env.local scripts/quiz-factory/run-bank.mjs --club Arsenal --cat history-honours --show-facts --dry-run\n`);
  process.exit(0);
}

// ── Real run (dry-run or commit) ────────────────────────────────────────────────
if (!CLUB) { console.error("Pass --club <name> (e.g. --club Arsenal)"); process.exit(1); }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

console.log(`\n🏦 Bank fill — ${CLUB}${COMMIT ? "" : "  (DRY RUN — no writes)"}`);
console.log(`   categories: ${cats.map((c) => CATEGORIES[c].label).join(", ")}\n`);

// ── SportMonks: built once per club, cached to disk ────────────────────────────
// TWO products from one fetch, and the split matters:
//
//   factsText   — the full rendered record (league-wide top scorers and all), for the
//                 VERIFIER. Breadth is right here: it's checking a claim, not writing one,
//                 and the league context is what catches "Haaland scored 27 in 2010-11"
//                 (Tevez got 20 that year, so nobody scored 27).
//   leagueFacts — the same record as TYPED, per-category facts about THIS CLUB ONLY, for the
//                 AUTHOR. Narrowness is right here: an author handed league-wide rows writes
//                 about other clubs, which is how 6 of 25 "Arsenal" questions turned out to be
//                 about City, United and Liverpool.
//
// Verification wants everything; authoring wants only what belongs. Same data, opposite needs.
let factsText = null;
let leagueFacts = [];
try {
  const fs = await clubFactSheet(CLUB, { fromYear: 2000 });
  if (fs.seasons.length) {
    factsText = factSheetText(fs);
    leagueFacts = sportmonksFacts(fs);
    const byCat = leagueFacts.reduce((a, f) => ({ ...a, [f.category]: (a[f.category] ?? 0) + 1 }), {});
    console.log(`   📊 SportMonks: ${fs.seasons.length} PL seasons, ${fs.titles.length} title(s)`);
    console.log(`      → ${leagueFacts.length} typed facts for authoring ${JSON.stringify(byCat)}; full record for verification.\n`);
  } else {
    console.log(`   ⚠️  no SportMonks PL record for "${CLUB}" — web-only for this club.\n`);
  }
} catch (e) {
  console.log(`   ⚠️  SportMonks unavailable (${e.message.slice(0, 60)}) — web-only.\n`);
}

// ── ONE research call for the whole club, filling only the feed's gaps ─────────
// Research is the only stage that touches web search, and it was ~72% of the cost — because
// we ran it once PER CATEGORY, four passes over the same club, and ~28 of the ~100 facts it
// returned duplicated what SportMonks had already given us free. Modern Era was the worst:
// we paid to web-research a category the feed covers almost entirely.
//
// Now it's one pass that's told what we already hold and asked only for what a league feed
// can't know — domestic cups, founding, appearance records, legends, rivalries.
const factPool = [...leagueFacts];

// --top-up: tell the researcher what we've ALREADY written questions about for this club, so a
// second pass goes one layer out instead of re-finding the same headline facts and having them
// deduped away. Needed because a club can be rich in rows but poor in DISTINCT FACTS —
// Bournemouth had 25 rivalries questions built on just 6 facts, capping its quiz at 6.
let avoid = [];
if (TOP_UP) {
  const { data } = await supabase
    .from("questions")
    .select("question")
    .eq("entity", CLUB).eq("status", "active").in("category", cats)
    .limit(200);
  avoid = (data ?? []).map((r) => r.question);
  console.log(`♻️  TOP-UP: steering research away from ${avoid.length} questions already in the bank.\n`);
}

try {
  const { facts, dropped, gaps } = await researchClubFacts({
    entity: CLUB,
    categories: cats.map((k) => ({ key: k, label: CATEGORIES[k].label, brief: CATEGORIES[k].brief, want: FACT_COUNT })),
    have: leagueFacts,
    avoid,
  });
  if (gaps.length) {
    console.log(`🔎 One research pass for ${CLUB} — gaps only:`);
    for (const g of gaps) console.log(`     ${g.key.padEnd(20)} hold ${String(g.held).padStart(2)} · need ${g.need}`);
  } else {
    console.log(`🔎 No research needed — the feed already covers every category.`);
  }
  factPool.push(...facts);
  const untrusted = dropped.filter((d) => d.reason.startsWith("untrusted")).length;
  const badTag = dropped.filter((d) => d.reason.startsWith("bad category")).length;
  const editorial = dropped.filter((d) => d.reason.startsWith("editorial"));
  console.log(`   → ${facts.length} facts kept (${dropped.length} dropped: ${untrusted} untrusted source, ${badTag} bad category tag, ${editorial.length} editorial)`);
  // Always show WHAT the editorial gate binned. It's the only gate making a taste judgement
  // rather than a factual one, so it's the one that could quietly be wrong.
  for (const d of editorial) console.log(`     ✂ ${d.reason} — ${d.fact}…`);
  console.log();
} catch (e) {
  if (e instanceof CreditExhausted) { console.error(`\n${e.message}`); process.exit(2); }
  // ABORT, don't degrade. Proceeding feed-only looks like it works and isn't: the feed only
  // covers 2 of 4 categories, so Legends and Rivalries get skipped, and the two that survive
  // are authored from far too few facts — a real run did History & Honours as 23 questions
  // from SIX facts, and Modern Era's pass rate fell to 36% on duplicates. That's thin,
  // repetitive content written into the bank because a laptop lost wifi for a minute.
  // A club is all-or-nothing: re-run it when the network is back.
  console.error(`\n✗ research failed for ${CLUB}: ${e.message.slice(0, 90)}`);
  console.error(`  ABORTING this club rather than writing a half-researched one.`);
  console.error(`  (the feed alone covers only Modern Era + part of History & Honours — the rest`);
  console.error(`   would be skipped, and those two would be authored from too few facts.)`);
  console.error(`  Nothing was written. Re-run the same command.\n`);
  process.exit(3);
}

let totalWritten = 0;

try {
  for (const catKey of cats) {
    const cat = CATEGORIES[catKey];
    console.log(`\n━━ ${CLUB} · ${cat.label}`);

    // ── 1. GATHER FACTS ────────────────────────────────────────────────────
    // Facts-first: everything downstream is derived from this sheet, so this is where the
    // rigour lives. SportMonks data is free and already verified; the web research pass is
    // ONE call (not one per question) and every fact must clear the source-tier gate.
    //
    // Facts stay TYPED until the moment of prompting. They are never concatenated into one
    // blob, because a blob can't be filtered: that's how league tables ended up in front of a
    // Rivalries author and produced "How many goals did Manchester City's Erling Haaland
    // score?" under Arsenal · Rivalries. buildAuthorSheet hands over facts tagged for THIS
    // club and THIS category and nothing else — contamination isn't guarded, it's unspeakable.
    let authorFacts;
    try {
      authorFacts = buildAuthorSheet({ entity: CLUB, category: catKey, facts: factPool });
    } catch (e) {
      // No facts for this category ⇒ no questions for this category. Never a fallback.
      console.log(`   ⚠️  ${e.message} — SKIPPING`);
      continue;
    }
    const researched = authorFacts.filter((f) => f.origin === "web");
    const sheet = renderFacts(authorFacts);
    const fromFeed = authorFacts.length - researched.length;
    console.log(`   author sheet: ${authorFacts.length} facts (${fromFeed} from the feed, ${researched.length} researched) — all tagged ${CLUB} · ${cat.label}`);

    // ── 2. AUTHOR FROM THE SHEET ONLY (no web search) ──────────────────────
    let candidates;
    try {
      ({ candidates } = await authorFromFacts({
        entity: CLUB, category: catKey, categoryBrief: cat.brief, factsText: sheet, count: COUNT,
      }));
    } catch (e) {
      if (e instanceof CreditExhausted) throw e;
      console.log(`   ⚠️  authoring failed — skipping: ${e.message.slice(0, 90)}`);
      continue;
    }
    console.log(`   authored ${candidates.length} candidates from the sheet`);

    // Map each question's fact_ref (the number it cited on OUR sheet) to that fact's stable
    // key, so the draw can avoid dealing two questions from the same fact in one quiz.
    // We resolve against our own numbering — never the model's paraphrase.
    //
    // ⚠️ Index into authorFacts, NOT `researched`. The sheet handed to the author is numbered
    // over authorFacts (feed + researched); `researched` is only the web-sourced subset. Using
    // it here silently mis-resolved every reference on a mixed sheet, and on Modern Era — where
    // every fact comes from the feed and `researched` is empty — it nulled ALL of them, so the
    // same-fact spoiler guard was inert on the one category that's fully grounded.
    for (const q of candidates) {
      const f = q.fact_ref ? authorFacts[q.fact_ref - 1] : null;
      q.fact_key = f?.key ?? null;
    }
    const untracked = candidates.filter((q) => !q.fact_key).length;
    if (untracked) console.log(`   ⚠️  ${untracked} question(s) didn't cite a usable fact — they'll be untracked (treated as unrelated)`);

    // ── 3. CHECK (cheap — consistency vs the sheet, no web) ────────────────
    const { passed: checked, dropped, stats } = await runGate(candidates, {
      supabase,
      entities: [CLUB],
      factsText: sheet,
      onProgress: ({ i, of }) => process.stdout.write(`\r   checking ${i}/${of}…   `),
    });
    process.stdout.write("\r".padEnd(30) + "\r");
    console.log(`   gate: ${stats.passed}/${stats.generated} passed (${Math.round(stats.passRate * 100)}%) · ${stats.verifiedViaFacts} checked against facts, no web`);

    // ── 4. RATE DIFFICULTY (separate rater, anchors, one batched call) ──────
    // Never the author's own claim — it drifts toward whatever mix it was asked for.
    const { rated } = await rateBatch(checked);
    const passed = rated;
    const mix = passed.reduce((a, q) => ({ ...a, [q.difficulty]: (a[q.difficulty] ?? 0) + 1 }), {});
    const reRated = passed.filter((q) => q._difficultyAdjusted?.length).length;
    console.log(`   difficulty (rated independently): ${JSON.stringify(mix)}${reRated ? ` · ${reRated} adjusted by guards` : ""}`);
    const byReason = {};
    for (const d of dropped) (byReason[d.reason.split(":")[0]] ??= 0), byReason[d.reason.split(":")[0]]++;
    for (const [k, n] of Object.entries(byReason)) console.log(`     ✗ ${k}: ${n}`);

    if (!passed.length) { console.log(`   nothing survived — skipping`); continue; }

    // The founder reviews the FACTS, not the questions — reviewing ~30 sourced facts is
    // faster and more reliable than auditing 30 derived artefacts, and a bad fact is the
    // only thing that can poison a batch (correlated failure).
    if (SHOW_FACTS && researched.length) {
      console.log(`\n   ── facts gathered (review these, not the questions) ──`);
      console.log(factsReviewText(researched).split("\n").map((l) => `   ${l}`).join("\n"));
      console.log();
    }

    if (!COMMIT) {
      console.log(`   would write ${passed.length} questions to the bank. Samples:`);
      for (const q of passed.slice(0, 4)) console.log(`     [${q.difficulty}] ${q.question}\n        → ${q.options[q.answer]}`);
      continue;
    }

    // ── Write to the bank ─────────────────────────────────────────────────────
    // Insert per-row so the partial unique index (entity, normalized text WHERE active)
    // rejects a stray dup as a single skipped row rather than 500-ing the whole batch.
    // The gate already deduped against the live bank; this is belt-and-braces.
    let written = 0, skipped = 0;
    for (const q of passed) {
      const row = {
        entity: CLUB, entity_type: "club", category: catKey,
        question: q.question, options: q.options, answer: q.answer,
        difficulty: q.difficulty, status: "active", source: "data-grounded",
        fact_key: q.fact_key ?? null,   // migration 81 — keeps same-fact questions out of one quiz
        verification_note: q.verification_note,
      };
      const { error } = await supabase.from("questions").insert(row);
      if (error) {
        if (error.code === "23505") skipped++;          // unique-index dup — expected, fine
        else console.error(`     ✗ insert failed: ${error.message}`);
      } else written++;
    }
    console.log(`   ✓ wrote ${written} to the bank${skipped ? ` (${skipped} dup-skipped)` : ""}`);
    totalWritten += written;
  }
} catch (e) {
  if (e instanceof CreditExhausted) { console.error(`\n${e.message}`); process.exit(2); }
  throw e;
}

console.log(`\n${"─".repeat(60)}`);
if (COMMIT) console.log(`✓ ${totalWritten} questions added to the bank for ${CLUB}`);
else console.log(`DRY RUN — nothing written. Add --commit to write.`);
console.log(`\nCost:\n${costReport()}`);
console.log(`  (running total this process: $${usage.usd.toFixed(2)})\n`);
