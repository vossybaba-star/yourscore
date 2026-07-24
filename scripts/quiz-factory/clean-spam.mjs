/**
 * Retire bulk-generated fabrications, sparing any member the data confirms.
 *
 *   node --env-file=.env.local scripts/quiz-factory/clean-spam.mjs            # REPORT
 *   node --env-file=.env.local scripts/quiz-factory/clean-spam.mjs --commit
 *
 * Two signals, deliberately combined — neither is safe alone:
 *
 *   1. THE SPAM PATTERN (free, no API). One player + one identical COUNT + many seasons =
 *      generated spam. "Morgan Gibbs-White scored 15" across EIGHTEEN seasons, starting the
 *      year he was born. A player scoring exactly the same number in 3+ seasons essentially
 *      never happens.
 *
 *   2. SPORTMONKS (cheap, no web). The pattern alone would over-retire, because ONE member of
 *      a spam group is usually the real fact the rest were cloned from — Haaland really did
 *      score 27, in 2023-24. So every member is checked, and anything the data CONFIRMS is kept.
 *
 * Why both: the SportMonks sweep can't catch these on its own (the worst sit in seasons with no
 * top-scorer data — pre-2005/06 — so there's no ceiling to reason from), and the pattern can't
 * tell the original from the clones. Together they're precise.
 *
 * Bias is toward keeping. This has already produced two rounds of false positives (Henry's 30
 * in 2003/04; Chelsea's 5 titles) because a gap in the data was read as a fact about the world.
 */

import { createClient } from "@supabase/supabase-js";
import { findSpamGroups, seasonOf } from "./spam-pattern.mjs";
import { verifyAgainstFacts } from "./verify.mjs";
import { clubFactSheet, factSheetText } from "../lib/sportmonks.mjs";
import { costReport, CreditExhausted } from "../lib/anthropic.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);
const COMMIT = process.argv.includes("--commit");

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("questions")
    .select("id, entity, entity_type, question, options, answer, difficulty")
    .eq("status", "active").order("id", { ascending: true }).range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const groups = findSpamGroups(rows);
const suspect = groups.flatMap((g) => g.ids);
console.log(`\n═══ BULK-FABRICATION CLEANUP ═══${COMMIT ? "" : "   (REPORT ONLY)"}\n`);
console.log(`Scanned ${rows.length} active questions (free).`);
console.log(`Bulk-generated groups: ${groups.length}  ·  ${suspect.length} questions implicated\n`);

for (const g of groups) {
  console.log(`  ${g.entity} · ${g.subject} = "${g.answer}" across ${g.seasons.length} seasons`);
}

// ── Check every implicated question against SportMonks; CONFIRMED ones are spared ──
const byId = new Map(rows.map((r) => [r.id, r]));
const sheets = {};
const toRetire = [];
const spared = [];

console.log(`\nChecking each against SportMonks — anything it confirms is kept…\n`);
try {
  for (const g of groups) {
    if (!sheets[g.entity]) {
      try {
        const fs = await clubFactSheet(g.entity, { fromYear: 2000 });
        sheets[g.entity] = fs.seasons.length ? factSheetText(fs) : null;
      } catch { sheets[g.entity] = null; }
    }
    const sheet = sheets[g.entity];
    for (const id of g.ids) {
      const r = byId.get(id);
      if (!sheet) { toRetire.push({ ...r, why: "spam pattern; no data to check against" }); continue; }
      try {
        const res = await verifyAgainstFacts(r, sheet);
        if (res.outcome === "verified") spared.push({ ...r, season: seasonOf(r.question) });
        else toRetire.push({ ...r, why: res.outcome === "disagree" ? "spam pattern + data contradicts it" : "spam pattern; data can't confirm it" });
      } catch (e) {
        if (e instanceof CreditExhausted) throw e;
        spared.push({ ...r, season: seasonOf(r.question), note: "check failed — kept" }); // fail safe: keep
      }
    }
  }
} catch (e) {
  if (e instanceof CreditExhausted) { console.error(`\n${e.message}`); process.exit(2); }
  throw e;
}

console.log(`✓ SPARED (the data confirms these — the real fact the clones were made from): ${spared.length}`);
for (const s of spared) console.log(`   [${s.season}] ${s.question.slice(0, 76)} → ${s.options?.[s.answer]}`);

console.log(`\n✗ TO RETIRE: ${toRetire.length}`);
for (const t of toRetire.slice(0, 8)) console.log(`   [${seasonOf(t.question)}] ${t.question.slice(0, 72)} → ${t.options?.[t.answer]}`);
if (toRetire.length > 8) console.log(`   …and ${toRetire.length - 8} more`);

if (!COMMIT) {
  console.log(`\nREPORT ONLY — add --commit to retire.\n${costReport()}\n`);
  process.exit(0);
}

let done = 0;
for (let i = 0; i < toRetire.length; i += 100) {
  const batch = toRetire.slice(i, i + 100);
  const { error } = await db.from("questions")
    .update({ status: "retired", verification_note: JSON.stringify({ retired_on: new Date().toISOString().slice(0, 10), reason: "bulk-generated fabrication (one tally cloned across seasons)" }) })
    .in("id", batch.map((r) => r.id));
  if (error) console.error(`   ✗ ${error.message}`);
  else done += batch.length;
}
console.log(`\n✓ retired ${done} bulk-generated questions, spared ${spared.length}\n${costReport()}\n`);
