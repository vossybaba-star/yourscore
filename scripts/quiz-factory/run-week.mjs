/**
 * The weekly pack factory. Runs Monday on the VPS.
 *
 *   node --env-file=.env.local scripts/quiz-factory/run-week.mjs             # DRY RUN
 *   node --env-file=.env.local scripts/quiz-factory/run-week.mjs --commit    # write drafts
 *   node --env-file=.env.local scripts/quiz-factory/run-week.mjs --packs 3 --start 2026-07-20
 *   node --env-file=.env.local scripts/quiz-factory/run-week.mjs --theme "Derby Days" --commit
 *
 * Pipeline:  pick themes → author (overgenerated, grounded) → THE GATE → select 15 →
 *            shuffle → insert as status='draft', approved_at=NULL, release_at=<staggered>
 *
 * Nothing it writes is visible to a player. Packs are invisible until the founder approves
 * them at /admin/quiz AND their release_at comes round — see scripts/release-packs.mjs.
 *
 * Releases are staggered every OTHER day, per the founder's cadence.
 */

import { createClient } from "@supabase/supabase-js";
import { pickThemes } from "./themes.mjs";
import { authorPack, selectPack, PACK_MIX } from "./author.mjs";
import { runGate } from "./verify.mjs";
import { shufflePack } from "../lib/shuffle-options.mjs";
import { costReport, CreditExhausted } from "../lib/anthropic.mjs";
import { sendMessage } from "../tg.mjs";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const NO_TELEGRAM = args.includes("--no-telegram");
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i !== -1 ? Number(args[i + 1]) : dflt;
};
const str = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : dflt;
};

const OVERGENERATE = num("--candidates", 26); // gate drops a lot; 26 → 15 with headroom

// The approved-themes path. `--themes "Theme A" "Theme B"` builds exactly the themes the
// founder picked off the shortlist (scripts/quiz-factory/propose-themes.mjs). Everything
// after --themes up to the next --flag is one theme. Each may carry its angle after "::"
// ("Title :: what the questions should cover"), so the founder's framing survives — this
// matters for themes like "Young Talents Rising :: their club records BEFORE this tournament"
// where the angle is what keeps the questions to fixed, non-rotting facts.
// This is the intended weekly flow; bare --packs (auto-pick) is a hands-off run with no
// prior approval.
function themesFlag() {
  const i = args.indexOf("--themes");
  if (i === -1) return null;
  const picked = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) {
    const [theme, ...rest] = args[j].split("::");
    picked.push({ theme: theme.trim(), angle: rest.join("::").trim() || null });
  }
  return picked.length ? picked : null;
}
const FORCED_THEMES = themesFlag() ?? (str("--theme", null) ? [{ theme: str("--theme", null), angle: null }] : null);
const PACKS = FORCED_THEMES ? FORCED_THEMES.length : num("--packs", 4);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Release dates: every OTHER day, starting the day after tomorrow ───────────
// (Never today — the founder needs a window to approve before anything can go out.)
const iso = (d) => d.toISOString().slice(0, 10);
function releaseDates(n, start) {
  const first = start ? new Date(`${start}T09:00:00Z`) : (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 2); d.setUTCHours(9, 0, 0, 0); return d;
  })();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(first.getUTCDate() + i * 2); // every other day
    return d;
  });
}

const dates = releaseDates(PACKS, str("--start", null));

console.log(`\n🏭 Quiz factory — ${PACKS} themed packs${COMMIT ? "" : "  (DRY RUN)"}`);
console.log(`   release dates: ${dates.map(iso).join(", ")}\n`);

// ── Themes ───────────────────────────────────────────────────────────────────
const { data: usedRows } = await supabase
  .from("quiz_packs")
  .select("theme")
  .not("theme", "is", null);
const used = (usedRows ?? []).map((r) => r.theme);

const themes = FORCED_THEMES
  ? FORCED_THEMES.map((t) => ({ theme: t.theme, angle: t.angle || `Questions on the theme: ${t.theme}`, source: "approved" }))
  : await pickThemes({ count: PACKS, dates: dates.map(iso), used });

console.log(`Themes (${used.length} already used, excluded):`);
themes.forEach((t, i) => console.log(`  ${i + 1}. [${t.source}] ${t.theme} — ${t.angle}`));
console.log();

// ── Author → gate → select → shuffle, one pack at a time ─────────────────────
const built = [];
const rejected = [];

try {
  for (const [i, t] of themes.entries()) {
    const releaseAt = dates[i] ?? dates[dates.length - 1];
    console.log(`\n━━ ${t.theme}  (releases ${iso(releaseAt)})`);

   let candidates;
   try {
     ({ candidates } = await authorPack({ theme: t.theme, angle: t.angle, count: OVERGENERATE }));
   } catch (e) {
     if (e instanceof CreditExhausted) throw e; // fatal — stop the whole run
     // Any other author failure (truncated JSON, transient API error) skips THIS theme
     // only. An unattended weekly job must not die on the first bad theme.
     console.log(`   ⚠️  authoring failed — skipping this theme: ${e.message.slice(0, 90)}`);
     rejected.push({ theme: t.theme, got: 0, target: 15, reason: "author" });
     continue;
   }
    console.log(`   authored ${candidates.length} candidates`);

    const { passed, dropped, stats } = await runGate(candidates, {
      supabase,
      onProgress: ({ i: n, of }) => process.stdout.write(`\r   verifying ${n}/${of}…   `),
    });
    process.stdout.write("\r".padEnd(30) + "\r");

    console.log(`   gate: ${stats.passed}/${stats.generated} passed (${Math.round(stats.passRate * 100)}%)`);
    // Show WHY things dropped — this is the signal that tells us if the gate is working
    // or if the authoring prompt is bad. Silent drops would make the gate unfalsifiable.
    const byReason = {};
    for (const d of dropped) {
      const k = d.reason.split(":")[0];
      (byReason[k] ??= []).push(d);
    }
    for (const [k, list] of Object.entries(byReason)) console.log(`     ✗ ${k}: ${list.length}`);
    if (dropped.length) {
      console.log(`     e.g. "${dropped[0].question.slice(0, 60)}…"\n          → ${dropped[0].reason}`);
    }

    const { pack, got, target } = selectPack(passed, PACK_MIX);
    if (!pack) {
      console.log(`   ⚠️  only ${got}/${target} survivors — SKIPPING this theme (a short pack is not shippable)`);
      rejected.push({ theme: t.theme, got, target });
      continue;
    }

    const questions = shufflePack(pack, t.theme).map((q) => ({
      question: q.question,
      options: q.options,
      answer: q.answer,
      difficulty: q.difficulty,
      verification_note: q.verification_note,
    }));

    const spread = {};
    for (const q of questions) spread[q.answer] = (spread[q.answer] ?? 0) + 1;
    console.log(`   ✓ pack built — 15 questions, answer spread ${JSON.stringify(spread)}`);

    built.push({
      name: t.theme,
      theme: t.theme,
      parameter: t.theme,
      type: "records",
      questions,
      release_at: releaseAt.toISOString(),
      source_kind: t.source,
    });
  }
} catch (e) {
  if (e instanceof CreditExhausted) {
    console.error(`\n${e.message}`);
    if (!NO_TELEGRAM) await sendMessage(`🏭 Quiz factory ABORTED — Anthropic out of credit. No packs written.`).catch(() => {});
    process.exit(2);
  }
  throw e;
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Built ${built.length}/${themes.length} packs`);
if (rejected.length) console.log(`Skipped: ${rejected.map((r) => `${r.theme} (${r.got}/${r.target})`).join(", ")}`);
console.log(`\nCost:\n${costReport()}`);

if (!COMMIT) {
  console.log(`\nDRY RUN — nothing written. Re-run with --commit.`);
  process.exit(0);
}

// ── Write drafts ─────────────────────────────────────────────────────────────
// status='draft' + rotation_active=false ⇒ invisible to players (the packs API filters on
// status='published' AND rotation_active). approved_at stays NULL: the release job will
// not touch a pack the founder has not approved.
let written = 0;
for (const p of built) {
  const row = {
    type: p.type,
    name: p.name,
    theme: p.theme,
    parameter: p.parameter,
    questions: p.questions,
    status: "draft",
    source: "system",
    rotation_active: false,
    featured: false,
    approved_at: null,
    release_at: p.release_at,
    metadata: { themed: true, theme: p.theme, theme_source: p.source_kind, authored_on: iso(new Date()) },
    updated_at: new Date().toISOString(),
  };

  // Upsert by name so a re-run replaces its own draft rather than duplicating it. Guarded:
  // NEVER overwrite a pack that is already live or already approved.
  const { data: existing } = await supabase
    .from("quiz_packs").select("id, status, approved_at").eq("name", p.name).maybeSingle();

  if (existing?.id) {
    if (existing.status === "published" || existing.approved_at) {
      console.log(`  ⊘ ${p.name} — already ${existing.status === "published" ? "live" : "approved"}, left alone`);
      continue;
    }
    const { error } = await supabase.from("quiz_packs").update(row).eq("id", existing.id);
    if (error) { console.error(`  ✗ ${p.name}: ${error.message}`); continue; }
    console.log(`  ↻ ${p.name} — draft replaced`);
  } else {
    const { error } = await supabase.from("quiz_packs").insert(row);
    if (error) { console.error(`  ✗ ${p.name}: ${error.message}`); continue; }
    console.log(`  + ${p.name} — draft created, releases ${iso(new Date(p.release_at))}`);
  }
  written++;
}

console.log(`\n✓ ${written} drafts awaiting approval at /admin/quiz`);

// ── Telegram nudge — the founder's cue to go and approve ─────────────────────
if (written && !NO_TELEGRAM) {
  const lines = built.slice(0, written).map((p) => `• ${p.theme} — ${iso(new Date(p.release_at))}`).join("\n");
  await sendMessage(
    `🏭 <b>${written} quiz packs ready for review</b>\n\n${lines}\n\n` +
    `Cost: $${(await import("../lib/anthropic.mjs")).usage.usd.toFixed(2)}\n\n` +
    `Approve → https://yourscore.app/admin/quiz\n\n<i>Nothing goes live until you approve it.</i>`
  ).catch((e) => console.error("Telegram nudge failed (packs are still written):", e.message));
}
