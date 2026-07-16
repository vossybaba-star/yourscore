/**
 * STAGE 1 of the weekly flow: research the week in football and propose a THEME SHORTLIST.
 *
 *   node --env-file=.env.local scripts/quiz-factory/propose-themes.mjs             # print
 *   node --env-file=.env.local scripts/quiz-factory/propose-themes.mjs --telegram  # + send
 *   node --env-file=.env.local scripts/quiz-factory/propose-themes.mjs --count 8
 *
 * This is the CHEAP step (~5¢). It does NOT write any questions and spends no money on
 * fact-checking. It exists so the founder approves the *themes* before any expensive
 * generation happens — the fix for "the cost per pack is unacceptable".
 *
 * Each theme is tagged with its source coverage, which is the cost driver:
 *   🟢 SportMonks (PL since 2000) — cheap to fact-check (data lookup, ~$0.60/pack)
 *   🟡 needs web sources          — pricier (~$3.50/pack)
 *
 * The founder replies with the numbers they want; scripts/quiz-factory/run-week.mjs then
 * builds ONLY those, so we never pay to generate a pack that would have been rejected.
 */

import { createClient } from "@supabase/supabase-js";
import { pickThemes, estCost, COVERAGE } from "./themes.mjs";
import { costReport } from "../lib/anthropic.mjs";
import { sendMessage } from "../tg.mjs";

const args = process.argv.slice(2);
const TELEGRAM = args.includes("--telegram");
const numArg = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i !== -1 ? Number(args[i + 1]) : dflt;
};
const COUNT = numArg("--count", 8);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Exclude themes we've already used, so the shortlist is always fresh.
let used = [];
if (SUPABASE_URL && SERVICE_KEY) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data } = await supabase.from("quiz_packs").select("theme").not("theme", "is", null);
  used = (data ?? []).map((r) => r.theme);
}

console.log(`\n🔎 Researching the week in football → ${COUNT} theme ideas\n`);

// Release dates aren't decided yet at shortlist time — the founder picks themes first, we
// schedule after. Pass an empty window so calendar pegs don't force themselves in here.
const themes = await pickThemes({ count: COUNT, dates: [], used });

if (!themes.length) {
  console.log("No themes proposed (news lookup returned nothing and evergreen is exhausted).");
  process.exit(0);
}

// ── Present ──────────────────────────────────────────────────────────────────
let totalIfAll = 0;
const lines = themes.map((t, i) => {
  const cov = COVERAGE[t.coverage] ?? COVERAGE.web;
  totalIfAll += estCost(t.coverage);
  return { i: i + 1, ...t, cov };
});

console.log("Theme shortlist — pick the ones worth building:\n");
for (const l of lines) {
  console.log(`  ${l.i}. ${l.cov.tag}  ${l.theme}   ~$${l.cov.estUsd.toFixed(2)}  [${l.source}]`);
  console.log(`       ${l.angle}`);
  console.log(`       source: ${l.cov.label}\n`);
}

const cheap = lines.filter((l) => l.coverage === "sportmonks").length;
console.log(`${cheap}/${lines.length} are 🟢 SportMonks-cheap. Building all ${lines.length} would cost ~$${totalIfAll.toFixed(2)}.`);
console.log(`\nStage-1 (this research) cost:\n${costReport()}`);
console.log(`\nNext: pick themes, then\n  node --env-file=.env.local scripts/quiz-factory/run-week.mjs --themes "<Theme A>" "<Theme B>" --commit\n`);

// ── Telegram (optional) — the founder's approval surface ─────────────────────
if (TELEGRAM) {
  const body =
    `🗓️ <b>Quiz theme shortlist</b>\n<i>Pick the numbers you want built. Nothing's generated yet.</i>\n\n` +
    lines
      .map((l) => `<b>${l.i}. ${l.cov.tag} ${l.theme}</b>  ~$${l.cov.estUsd.toFixed(2)}\n${l.angle}`)
      .join("\n\n") +
    `\n\n🟢 = cheap (SportMonks PL data)  ·  🟡 = pricier (web sources)\n` +
    `Reply with the numbers, e.g. “1, 4, 5”.`;
  await sendMessage(body).catch((e) => console.error("Telegram send failed:", e.message));
  console.log("→ shortlist sent to Telegram.");
}
