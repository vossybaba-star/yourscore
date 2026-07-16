/**
 * Fill the cross-club RECORD TOPICS that build-your-own (/quiz/create) offers.
 *
 *   node --env-file=.env.local scripts/quiz-factory/run-records.mjs                     # PROJECT (no spend)
 *   node --env-file=.env.local scripts/quiz-factory/run-records.mjs --topic "Champions League Records" --dry-run
 *   node --env-file=.env.local scripts/quiz-factory/run-records.mjs --topic "Champions League Records" --commit
 *
 * These are `questions` rows with entity_type='records' and entity = the topic label exactly
 * as `/quiz/create` sends it (RECORD_TOPICS in src/app/quiz/create/page.tsx). They are
 * CROSS-CLUB, which is why the European data belongs here rather than in a per-club category:
 * only 6 of 20 PL clubs have real European history, but every fan can play a Champions League
 * quiz.
 *
 * ── Why this is urgent ────────────────────────────────────────────────────────
 * "Champions League Records" is SELECTABLE BY USERS RIGHT NOW and holds 10 questions. The
 * draw needs 15 (6 easy / 6 medium / 3 hard). So picking it today yields a broken quiz. This
 * is a live defect, not a future feature.
 *
 * The European topics are grounded in the cached finals index (every UCL/UEL/UECL/Super Cup
 * final since 2000) — no web search, so they cost tokens only.
 */

import { createClient } from "@supabase/supabase-js";
import { authorFromFacts } from "./author.mjs";
import { runGate } from "./verify.mjs";
import { rateBatch } from "./difficulty.mjs";
import { researchFacts, factsText as renderFacts, factKey } from "./facts.mjs";
import { europeanFinalsIndex, finalsText, plSeasons, finalTable, topScorers } from "../lib/sportmonks.mjs";
import { costReport, usage, CreditExhausted } from "../lib/anthropic.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const TOPIC = arg("--topic", null);
const COUNT = Number(arg("--count", 40));
const DRY = has("--dry-run");
const COMMIT = has("--commit");
const PROJECT = !DRY && !COMMIT;

/**
 * The topics. `entity` MUST match the label /quiz/create posts, or the questions are
 * unreachable. `facts` builds a grounded sheet from cached SportMonks data (free); topics
 * without one fall back to a web research pass.
 */
export const TOPICS = {
  "Champions League Records": {
    live: true,
    brief: "The Champions League — finals, winners, famous matches and scoring records. Always name the season.",
    facts: async () => {
      const finals = await europeanFinalsIndex({ fromYear: 2000 });
      return finalsText(finals.filter((f) => f.short === "UCL"));
    },
  },
  "Premier League Records": {
    live: true,
    brief: "Premier League records — champions, points totals, Golden Boot winners, famous seasons. Always name the season.",
    facts: async () => {
      const seasons = (await plSeasons()).filter((s) => s.startYear >= 2000 && s.startYear <= 2025);
      const lines = [];
      for (const s of seasons) {
        const [table, scorers] = await Promise.all([finalTable(s.id), topScorers(s.id)]);
        const champ = table.find((r) => r.position === 1);
        const bottom = table.filter((r) => r.position >= 18).map((r) => r.team).join(", ");
        if (champ) lines.push(`${s.name} Premier League: champions ${champ.team} with ${champ.points} points; relegated: ${bottom}; Golden Boot ${scorers[0]?.player} (${scorers[0]?.goals} goals, ${scorers[0]?.team}).`);
      }
      return lines.join("\n");
    },
  },
  "Golden Boot & Individual Awards": {
    live: false, // marked comingSoon in /quiz/create — flip that flag once this is filled
    brief: "The Premier League Golden Boot — who won it, with how many goals, for which club. Always name the season.",
    facts: async () => {
      const seasons = (await plSeasons()).filter((s) => s.startYear >= 2000 && s.startYear <= 2025);
      const lines = [];
      for (const s of seasons) {
        const scorers = await topScorers(s.id);
        const top = scorers.slice(0, 3).map((r) => `${r.player} (${r.goals}, ${r.team})`).join("; ");
        if (top) lines.push(`${s.name} Premier League top scorers: ${top}.`);
      }
      return lines.join("\n");
    },
  },
  "Legendary Club Seasons": {
    live: false,
    brief: "Famous single seasons — the Invincibles, record points hauls, shock title wins, record relegations. Always name the season and competition.",
    facts: async () => {
      const seasons = (await plSeasons()).filter((s) => s.startYear >= 2000 && s.startYear <= 2025);
      const lines = [];
      for (const s of seasons) {
        const table = await finalTable(s.id);
        const champ = table.find((r) => r.position === 1);
        const runner = table.find((r) => r.position === 2);
        if (champ) lines.push(`${s.name} Premier League: ${champ.team} champions on ${champ.points} points, runners-up ${runner?.team} on ${runner?.points}.`);
      }
      return lines.join("\n");
    },
  },
};

if (PROJECT) {
  console.log(`\n🔮 RECORD TOPICS — no API calls, nothing spent.\n`);
  console.log(`These are CROSS-CLUB topics in build-your-own (/quiz/create). The European data`);
  console.log(`lives here: every fan can play a Champions League quiz, even a Brentford fan.\n`);
  for (const [name, t] of Object.entries(TOPICS)) {
    const grounded = Boolean(t.facts);
    console.log(`  ${name.padEnd(34)} ${t.live ? "LIVE " : "hidden"}  ${grounded ? "SportMonks-grounded (~$0.6/40q)" : "needs web research (~$1/40q)"}`);
  }
  console.log(`\n  ⚠️  "Champions League Records" is LIVE with 10 questions. The draw needs 15.`);
  console.log(`      Anyone picking it today gets a broken quiz.\n`);
  console.log(`Run:  node --env-file=.env.local scripts/quiz-factory/run-records.mjs --topic "Champions League Records" --dry-run\n`);
  process.exit(0);
}

if (!TOPIC || !TOPICS[TOPIC]) {
  console.error(`Pass --topic "<name>". Known: ${Object.keys(TOPICS).join(" | ")}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const topic = TOPICS[TOPIC];
console.log(`\n🏆 ${TOPIC}${COMMIT ? "" : "  (DRY RUN)"}\n`);

const { count: existing } = await supabase
  .from("questions").select("id", { count: "exact", head: true })
  .eq("status", "active").eq("entity", TOPIC);
console.log(`   already in the bank: ${existing ?? 0}\n`);

// ── 1. FACTS ─────────────────────────────────────────────────────────────────
let sheet = "";
let researched = [];
if (topic.facts) {
  sheet = await topic.facts();
  // Grounded sheets are already verified data — give each line a stable key so the draw can
  // keep two questions off the same final out of one quiz.
  researched = sheet.split("\n").filter(Boolean).map((line) => ({
    fact: line, key: factKey(line), source_url: "https://www.sportmonks.com/", tier: 1,
  }));
  console.log(`   📊 SportMonks fact sheet: ${researched.length} facts (no web search)\n`);
} else {
  const { facts } = await researchFacts({ entity: TOPIC, category: "records", categoryBrief: topic.brief, count: COUNT });
  researched = facts;
  sheet = renderFacts(facts);
  console.log(`   researched ${facts.length} facts\n`);
}
if (!sheet.trim()) { console.error("   no facts — aborting"); process.exit(1); }

// ── 2. AUTHOR ────────────────────────────────────────────────────────────────
let candidates;
try {
  ({ candidates } = await authorFromFacts({
    entity: TOPIC, category: "records", categoryBrief: topic.brief, factsText: sheet, count: COUNT,
  }));
} catch (e) {
  if (e instanceof CreditExhausted) { console.error(`\n${e.message}`); process.exit(2); }
  throw e;
}
for (const q of candidates) q.fact_key = q.fact_ref ? researched[q.fact_ref - 1]?.key ?? null : null;
console.log(`   authored ${candidates.length} candidates`);

// ── 3. CHECK ─────────────────────────────────────────────────────────────────
const { passed: checked, stats } = await runGate(candidates, {
  supabase, entities: [TOPIC], factsText: sheet,
  onProgress: ({ i, of }) => process.stdout.write(`\r   checking ${i}/${of}…   `),
});
process.stdout.write("\r".padEnd(30) + "\r");
console.log(`   gate: ${stats.passed}/${stats.generated} passed`);

// ── 4. RATE ──────────────────────────────────────────────────────────────────
const { rated: passed } = await rateBatch(checked);
const mix = passed.reduce((a, q) => ({ ...a, [q.difficulty]: (a[q.difficulty] ?? 0) + 1 }), {});
console.log(`   difficulty: ${JSON.stringify(mix)}\n`);

if (!COMMIT) {
  console.log(`   would write ${passed.length}. Samples:`);
  for (const q of passed.slice(0, 4)) console.log(`     [${q.difficulty}] ${q.question}\n        → ${q.options[q.answer]}`);
  console.log(`\nCost:\n${costReport()}\n`);
  process.exit(0);
}

// ── 5. WRITE ─────────────────────────────────────────────────────────────────
let written = 0, skipped = 0;
for (const q of passed) {
  const { error } = await supabase.from("questions").insert({
    entity: TOPIC, entity_type: "records", category: "records",
    question: q.question, options: q.options, answer: q.answer,
    difficulty: q.difficulty, status: "active", source: "data-grounded",
    fact_key: q.fact_key ?? null, verification_note: q.verification_note,
  });
  if (error) { if (error.code === "23505") skipped++; else console.error(`   ✗ ${error.message}`); }
  else written++;
}
const { count: now } = await supabase
  .from("questions").select("id", { count: "exact", head: true })
  .eq("status", "active").eq("entity", TOPIC);
console.log(`✓ wrote ${written}${skipped ? ` (${skipped} dup-skipped)` : ""} — "${TOPIC}" now has ${now} questions`);
console.log(`\nCost:\n${costReport()}\n  total $${usage.usd.toFixed(2)}\n`);
