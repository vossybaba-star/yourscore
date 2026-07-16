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
import { researchFacts, factsText as renderFacts, factsReviewText } from "./facts.mjs";
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
const COUNT = Number(arg("--count", 30));       // questions to author from the sheet
const FACT_COUNT = Number(arg("--facts", 30));  // facts to research first (ONE call, not one per question)
const SHOW_FACTS = has("--show-facts");         // print the sheet for review
const DRY = has("--dry-run");
const COMMIT = has("--commit");
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

// ── SportMonks fact sheet: built once per club, cached to disk ──────────────────
// Handed to the verifier for EVERY category (cheap confirmation of anything it covers),
// and used as the authoring source for `grounded` categories. If SportMonks is
// unavailable, we fall back to web-only — the factory still works, just costs more.
let factsText = null;
try {
  const fs = await clubFactSheet(CLUB, { fromYear: 2000 });
  if (fs.seasons.length) {
    factsText = factSheetText(fs);
    console.log(`   📊 SportMonks fact sheet: ${fs.seasons.length} PL seasons, ${fs.titles.length} title(s) — grounding verification.\n`);
  } else {
    console.log(`   ⚠️  no SportMonks PL record for "${CLUB}" — web-only for this club.\n`);
  }
} catch (e) {
  console.log(`   ⚠️  SportMonks unavailable (${e.message.slice(0, 60)}) — web-only.\n`);
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
    let sheet = factsText ?? "";
    let researched = [];

    if (!cat.grounded || cat.factCoverage < 1) {
      const { facts, dropped: factsDropped } = await researchFacts({
        entity: CLUB, category: catKey, categoryBrief: cat.brief, count: FACT_COUNT,
      });
      researched = facts;
      console.log(`   researched ${facts.length} facts (${factsDropped.length} dropped: ${
        factsDropped.filter((d) => d.reason.startsWith("untrusted")).length} untrusted source)`);
      if (facts.length) sheet = `${sheet}\n\nResearched facts:\n${renderFacts(facts)}`;
    }

    if (!sheet.trim()) { console.log(`   ⚠️  no facts gathered — skipping`); continue; }

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
    for (const q of candidates) {
      const f = q.fact_ref ? researched[q.fact_ref - 1] : null;
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
