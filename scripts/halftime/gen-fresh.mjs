#!/usr/bin/env node
/**
 * gen-fresh.mjs — the fresh slice. Runs the moment the confirmed team sheets land
 * (~T-60), and never again: everything it produces is frozen before the kickoff
 * whistle, which is what makes "no first-half facts" structural rather than a
 * matter of the prompt behaving itself.
 *
 * Pipeline:
 *   1. assert SportMonks entitlements (the trial expires 2026-07-22)
 *   2. confirm the team sheets are actually confirmed (>= 11 a side)
 *   3. MINE the reveals from the XI              (lib/dossier.mjs — deterministic)
 *   4. LLM writes <= 3 questions from the dossier and NOTHING else  (lib/llm.mjs)
 *   5. re-attach the miner's claims by fact id — the model does not get to
 *      supply its own evidence
 *   6. VALIDATE: text gate + re-resolve every claim against SportMonks
 *   7. persist to halftime_releases via POST /api/halftime/fresh, then re-read
 *      and assert it landed
 *
 * An empty fresh slice is a NORMAL OUTCOME (no lineups, thin dossier, everything
 * dropped). The pack ships base-only and nobody is woken up.
 *
 * CLI contract (spec §5):
 *   gen-fresh.mjs --fixture <id>          exit 0 = persisted (or skipped), 2 = bounded failure
 *     --dry-run        mine + write + validate, print, persist nothing
 *     --historical     STRICT AS-OF: drop every fact derived from a season
 *                      aggregate, because against an already-played fixture those
 *                      totals silently include the match itself. This is what
 *                      makes an off-season demo honest.
 *     --kickoff <ISO>  override (replay)
 *     --out <path>     write the slice to a file too
 */

import { writeFileSync, readFileSync } from "node:fs";
import * as sm from "./lib/sm.mjs";
import * as api from "./lib/api.mjs";
import { mineFreshFacts } from "./lib/dossier.mjs";
import { writeQuestions, modelId } from "./lib/llm.mjs";
import { validateQuestions, makeContext } from "./validate.mjs";
import { audit } from "./lib/audit.mjs";
import { loadEnvFile, flag, has } from "./lib/env.mjs";

const MAX_FRESH = 3;
const PROMPT = "scripts/halftime/prompts/fresh.md";

const londonDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** Render the dossier the model is allowed to see. Nothing else reaches it. */
export function renderPrompt({ meta, facts, whitelist }) {
  const lines = facts
    .slice(0, 14)
    .map(
      (f) =>
        `[${f.id}]${f.asofSafe ? "" : " (MUTABLE — needs a pre-kick-off anchor)"} ${f.text}`,
    )
    .join("\n");

  return [
    `FIXTURE: ${meta.home} v ${meta.away}`,
    `KICK-OFF: ${meta.kickoff}`,
    ``,
    `DOSSIER — every one of these is already verified. Use nothing else.`,
    lines || "(nothing)",
    ``,
    `WHITELIST — the only people you may name, in the stem or in any option:`,
    whitelist.join(", "),
    ``,
    `Write up to ${MAX_FRESH} questions. Pick the ${MAX_FRESH} most surprising facts —`,
    `the ones that make someone go "how did they know that". Fewer is fine. Zero is fine.`,
  ].join("\n");
}

async function main() {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const fixtureId = Number(flag(argv, "--fixture"));
  const dryRun = has(argv, "--dry-run");
  const historical = has(argv, "--historical");
  const outPath = flag(argv, "--out");

  if (!fixtureId) {
    console.error("usage: gen-fresh.mjs --fixture <id> [--dry-run] [--historical] [--kickoff ISO] [--out path]");
    process.exit(2);
  }

  const ent = await sm.assertEntitlements();
  if (!ent.ok) {
    console.error(`✗ SportMonks entitlements missing: ${ent.missing.join(", ")}`);
    process.exit(2);
  }

  const fx = await sm.fixture(fixtureId, "participants");
  if (!fx) {
    console.error(`✗ fixture ${fixtureId} not found`);
    process.exit(2);
  }
  const kickoff = flag(argv, "--kickoff") || fx.starting_at;
  const matchday = londonDay(kickoff);
  const log = (m) => console.error(`  · ${m}`);

  // 1 + 2. Mine. Returns confirmed:false if the sheets aren't in yet.
  const { facts, whitelist, clubs, meta } = await mineFreshFacts({
    fixtureId,
    kickoffAt: kickoff,
    strictAsOf: historical,
    log,
  });

  if (!meta.confirmed) {
    console.error(`· lineups not confirmed for ${fixtureId} — fresh slice SKIPPED (base-only pack)`);
    audit(matchday, "fresh.skipped", { fixtureId, reason: "lineups not confirmed" });
    if (!dryRun) await api.putFresh(fixtureId, [], "skipped");
    process.exit(0);
  }

  console.error(
    `· ${meta.home} v ${meta.away} — mined ${facts.length} reveals` +
      (meta.dropped ? ` (${meta.dropped} dropped by strict as-of)` : "") +
      ` from ${meta.smCalls} SportMonks calls`,
  );

  if (!facts.length) {
    console.error("· nothing surprising in this team sheet — fresh slice SKIPPED (base-only pack)");
    audit(matchday, "fresh.skipped", { fixtureId, reason: "no reveals mined" });
    if (!dryRun) await api.putFresh(fixtureId, [], "skipped");
    process.exit(0);
  }

  // 3. The LLM. Its input is the dossier and the whitelist. That is all.
  const system = readFileSync(PROMPT, "utf8");
  const prompt = renderPrompt({ meta, facts, whitelist });
  const res = await writeQuestions({ system, prompt, maxTokens: 3000 });
  console.error(`· ${modelId()} wrote ${res.questions.length}${res.refused ? " (REFUSED)" : ""}`);

  // 4. Re-attach the miner's claims. The model cited fact ids; it did not get to
  //    supply evidence. A question citing an id it wasn't given carries no claims
  //    and is therefore ungrounded — the validator kills it.
  const byId = new Map(facts.map((f) => [f.id, f]));
  const withClaims = res.questions.slice(0, MAX_FRESH).map((q) => {
    const cited = (q.fact_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
    return {
      question: q.question,
      options: q.options,
      answer: q.answer,
      difficulty: q.difficulty,
      named_entities: q.named_entities ?? [],
      claims: cited.flatMap((f) => f.claims),
      // The founder-facing evidence line, not the prompt seed.
      fact: cited.map((f) => f.evidence ?? f.text).join(" "),
      status: "pending",
    };
  });

  // 5. THE HARD GATE.
  const ctx = makeContext({ fixtureId, kickoff, homeId: meta.homeId, awayId: meta.awayId });
  const { kept: validated, dropped } = await validateQuestions(withClaims, {
    pass: "fresh",
    whitelist,
    clubs,
    ctx,
  });

  for (const d of dropped) {
    console.error(`  ✗ DROPPED: ${d.question}`);
    for (const r of d.reasons) console.error(`      · ${r}`);
    audit(matchday, "gate.dropped", { fixtureId, question: d.question, reasons: d.reasons });
  }

  // Season-wide dedup (AC6): same check as the base pass — a fresh question
  // that already went out (or lives in the bank) is dropped, never re-served.
  let kept = validated;
  if (validated.length) {
    const collisions = new Set(
      await api.dedupCheck(validated.map((q) => q.question), Number(fixtureId)),
    );
    if (collisions.size) {
      for (const i of collisions) {
        console.error(`  ✗ DUPLICATE (bank/season): ${validated[i].question}`);
        dropped.push({ ...validated[i], reasons: ["duplicate of bank or season halftime question"] });
        audit(matchday, "gate.dropped", {
          fixtureId,
          question: validated[i].question,
          reasons: ["duplicate of bank or season halftime question"],
        });
      }
      kept = validated.filter((_, i) => !collisions.has(i));
    }
  }
  console.error(`· validator: kept ${kept.length}, dropped ${dropped.length}`);

  const payload = {
    fixtureId,
    kickoff,
    matchday,
    home: meta.home,
    away: meta.away,
    whitelist,
    clubs,
    model: modelId(),
    strictAsOf: historical,
    questions: kept,
    dropped,
    dossier: facts,
  };

  if (outPath) writeFileSync(outPath, JSON.stringify(payload, null, 2));

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  // 6. Persist + ASSERT (LOOP rule 1 — never trust the 200).
  const state = kept.length ? "pending_veto" : "skipped";
  await api.putFresh(fixtureId, kept, state);
  const back = await api.schedule(matchday);
  const row = (back.fixtures ?? []).find((f) => Number(f.fixture_id) === fixtureId);
  if (!row || (row.fresh_questions ?? []).length !== kept.length) {
    console.error(`✗ persisted ${kept.length} but re-read says ${(row?.fresh_questions ?? []).length}`);
    process.exit(2);
  }

  audit(matchday, "fresh.persisted", {
    fixtureId,
    kept: kept.length,
    dropped: dropped.length,
    model: modelId(),
    state,
  });
  console.error(`✓ ${kept.length} fresh question(s) persisted, fresh_state=${state}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(2);
});
