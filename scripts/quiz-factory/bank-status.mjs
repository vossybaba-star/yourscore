/**
 * What can the club draw ACTUALLY deal right now?
 *
 *   node --env-file=.env.local scripts/quiz-factory/bank-status.mjs
 *   node --env-file=.env.local scripts/quiz-factory/bank-status.mjs --cat rivalries-derbies
 *
 * Read-only. No API calls.
 *
 * TWO NUMBERS, AND THE SECOND IS THE HONEST ONE.
 *
 * Question count flatters. The draw uses fact_key to avoid dealing two questions built from
 * the same researched fact into one quiz (they spoil each other), so a club's real ceiling is
 * its DISTINCT FACT COUNT, not its row count. Bournemouth has 25 rivalries rows built on 6
 * facts: the bank looks fine and the quiz caps out at 6 questions. Reporting rows alone would
 * have called that club done.
 */

import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const ONLY = arg("--cat", null);

const CATS = ["history-honours", "legends", "modern-era", "rivalries-derbies"];
const cats = ONLY ? [ONLY] : CATS;
const MIX = { easy: 2, medium: 5, hard: 8 };
const NEED = 15;

const PL = [
  "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton & Hove Albion",
  "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham",
  "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United",
  "Nottingham Forest", "Sunderland", "Tottenham Hotspur", "West Ham United",
  "Wolverhampton Wanderers",
];

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("questions")
    .select("entity, category, difficulty, fact_key")
    .eq("status", "active").eq("entity_type", "club").eq("source", "data-grounded")
    .order("id").range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const cell = {};
for (const r of rows) {
  if (!cats.includes(r.category) || !PL.includes(r.entity)) continue;
  const k = `${r.entity}||${r.category}`;
  const c = (cell[k] ??= { total: 0, easy: 0, medium: 0, hard: 0, facts: new Set(), untracked: 0 });
  c.total++;
  if (c[r.difficulty] !== undefined) c[r.difficulty]++;
  // A null fact_key can't be proven to share a fact with anything, so the draw treats it as
  // unrelated — it counts toward the ceiling on its own.
  if (r.fact_key) c.facts.add(r.fact_key); else c.untracked++;
}

const ceiling = (c) => c.facts.size + c.untracked;

for (const category of cats) {
  console.log(`\n━━ ${category}\n`);
  console.log("club".padEnd(26) + "rows   e/m/h      facts  ceiling  verdict");
  let dealable = 0;
  for (const club of PL) {
    const c = cell[`${club}||${category}`];
    if (!c) { console.log(club.padEnd(26) + "   —"); continue; }
    const cap = ceiling(c);
    const mixOk = Object.entries(MIX).every(([d, n]) => c[d] >= n);
    const capOk = cap >= NEED;
    const ok = mixOk && capOk;
    if (ok) dealable++;
    const why = ok ? "FULL 15"
      : !capOk && !mixOk ? `capped ${cap} · short ${Object.entries(MIX).filter(([d, n]) => c[d] < n).map(([d]) => d).join("+")}`
      : !capOk ? `capped at ${cap} distinct facts`
      : `short ${Object.entries(MIX).filter(([d, n]) => c[d] < n).map(([d, n]) => `${d} ${c[d]}/${n}`).join(", ")}`;
    console.log(
      club.padEnd(26) +
      String(c.total).padStart(4) + "   " +
      `${c.easy}/${c.medium}/${c.hard}`.padEnd(10) +
      String(c.facts.size).padStart(4) + "   " +
      String(cap).padStart(5) + "    " + why
    );
  }
  console.log(`\n  dealable as a full 15-question quiz: ${dealable}/${PL.length}`);
}
