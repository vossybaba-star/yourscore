/**
 * Read-only audit of the live question bank (`questions`). No AI, no writes.
 *
 *   node --env-file=.env.local scripts/quiz-factory/audit-bank.mjs
 *   node --env-file=.env.local scripts/quiz-factory/audit-bank.mjs --entity Arsenal
 *
 * Answers "what's actually in the bank right now, and is it any good?" — the thing to
 * look at before deciding how the new 4 club categories relate to what's already there.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (source .env.local)"); process.exit(1); }
const db = createClient(url, key);

const entityFilter = (() => {
  const i = process.argv.indexOf("--entity");
  return i !== -1 ? process.argv[i + 1] : null;
})();

const DIFF_ORDER = ["easy", "medium", "hard", "expert", "master"];

// Fetch ALL active rows, paginated past PostgREST's 1000-row cap.
async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("questions")
      .select("entity, entity_type, category, difficulty, question, options, answer")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (entityFilter) q = q.eq("entity", entityFilter);
    const { data, error } = await q;
    if (error) { console.error(error.message); process.exit(1); }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const rows = await fetchAll();
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const bar = (n, max, w = 24) => "█".repeat(Math.round((n / max) * w)).padEnd(w);

console.log(`\n═══ QUESTION BANK AUDIT ${entityFilter ? `— ${entityFilter}` : ""} ═══`);
console.log(`\nActive questions: ${rows.length}`);

// ── By entity_type ────────────────────────────────────────────────────────────
const byType = {};
for (const r of rows) byType[r.entity_type] = (byType[r.entity_type] ?? 0) + 1;
console.log(`\nBy type:`);
for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1]))
  console.log(`  ${t.padEnd(16)} ${n}`);

// ── The difficulty problem ─────────────────────────────────────────────────────
const byDiff = {};
for (const r of rows) byDiff[r.difficulty] = (byDiff[r.difficulty] ?? 0) + 1;
console.log(`\nDifficulty spread (the new-player problem — should skew EASY, currently doesn't):`);
const maxDiff = Math.max(...Object.values(byDiff));
for (const d of DIFF_ORDER) {
  if (!byDiff[d]) continue;
  console.log(`  ${d.padEnd(8)} ${bar(byDiff[d], maxDiff)} ${byDiff[d]} (${pct(byDiff[d], rows.length)}%)`);
}

// ── Categories (club rows) + difficulty within each ────────────────────────────
const clubRows = rows.filter((r) => r.entity_type === "club");
const byCat = {};
for (const r of clubRows) {
  const c = r.category ?? "(none)";
  (byCat[c] ??= { total: 0, easy: 0 }).total++;
  if (r.difficulty === "easy") byCat[c].easy++;
}
console.log(`\nClub-question categories (${clubRows.length} rows) — with easy share:`);
const maxCat = Math.max(...Object.values(byCat).map((c) => c.total));
for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1].total - a[1].total))
  console.log(`  ${c.padEnd(22)} ${bar(v.total, maxCat)} ${String(v.total).padStart(4)}  (${pct(v.easy, v.total)}% easy)`);

// ── Sample questions per category — the quality read ───────────────────────────
console.log(`\nSample questions (2 per category — is this the quality/difficulty we want?):`);
for (const c of Object.keys(byCat)) {
  const samples = clubRows.filter((r) => (r.category ?? "(none)") === c).slice(0, 2);
  console.log(`\n  ▸ ${c}`);
  for (const s of samples) {
    console.log(`    [${s.difficulty}] ${s.entity}: ${s.question}`);
    console.log(`       → ${s.options?.[s.answer]}`);
  }
}

// ── Proposed mapping onto the 4 new locked categories ──────────────────────────
console.log(`\n─── How the OLD 6 could map onto the NEW 4 locked categories ───`);
const MAP = {
  "Trophies & Honours": "history-honours",
  "Club History": "history-honours",
  "Stadiums & Grounds": "history-honours",
  "Players & Goals": "legends",
  "Records & Milestones": "legends",
  "Season Performance": "modern-era OR history (needs era split — see note)",
};
for (const [oldC, newC] of Object.entries(MAP)) {
  const n = byCat[oldC]?.total ?? 0;
  if (n) console.log(`  ${oldC.padEnd(22)} → ${newC}  (${n})`);
}
console.log(`\n  NOTE: "Season Performance" (${byCat["Season Performance"]?.total ?? 0}) is the big one and is`);
console.log(`  era-ambiguous — a 2003/04 season question is History, a 2023/24 one is Modern Era.`);
console.log(`  It'd need an era split (cheap: questions already carry an 'era' column or a year in text).`);
console.log(`  Nothing here maps cleanly to "Transfers & Rivalries" — that category is net-new content.\n`);
