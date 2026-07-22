#!/usr/bin/env node
/**
 * gen-base.mjs — the base slate. Ten questions per fixture, written the DAY
 * BEFORE from historic/static facts, and therefore incapable of going stale.
 *
 * Base is a COMPLETE pack, not a partial. If everything downstream fails — no
 * lineups, validator drops the whole fresh slice, founder vetoes all, kill
 * switch, Telegram down — the fixture still releases a full ten-question pack at
 * the whistle with zero founder involvement. That graceful degradation is the
 * backbone of a season-long feature; the fresh slice is the topping.
 *
 * NEVER PADS. If the fixture's history and our datasets only support seven
 * grounded questions, this writes seven and says so. It does not ask the model to
 * make up the other three. A fixture that cannot reach ten by the slate gate is
 * the founder's call to make, not the generator's.
 *
 * CLI (spec §5):
 *   gen-base.mjs --date 2026-08-22            all PL fixtures that day
 *   gen-base.mjs --fixture 19722203           one fixture
 *     --dry-run    print, persist nothing
 *     --out <dir>  also write per-fixture JSON + a slate sidecar with provenance
 *
 * Exit 0 = every fixture produced a slate · 1 = some fixture came up short · 2 = failure.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import * as sm from "./lib/sm.mjs";
import * as api from "./lib/api.mjs";
import { mineBaseFacts } from "./lib/history.mjs";
import { writeQuestions, modelId } from "./lib/llm.mjs";
import { validateQuestions, makeContext } from "./validate.mjs";
import { audit } from "./lib/audit.mjs";
import { loadEnvFile, flag, has } from "./lib/env.mjs";

const PACK = 10;
const MIX = { easy: 3, medium: 4, hard: 3 };
const PROMPT = "scripts/halftime/prompts/base.md";
const MAX_ROUNDS = 2; // bounded retry (LOOP rule 3)

const londonDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

function renderPrompt({ report, facts, whitelist, need, avoid }) {
  const lines = facts.map((f) => `[${f.id}] ${f.text}`).join("\n");
  return [
    `FIXTURE: ${report.home} v ${report.away} (kick-off ${report.kickoff})`,
    ``,
    `DOSSIER — historic and static facts, all verified. Use nothing else.`,
    lines || "(nothing)",
    ``,
    `WHITELIST — the only people you may name, in the stem or in any option:`,
    whitelist.length ? whitelist.join(", ") : "(none — do not name any individual)",
    ``,
    avoid.length
      ? `ALREADY WRITTEN — do not repeat these, or anything that is the same question in different words:\n${avoid.map((q) => `- ${q}`).join("\n")}\n`
      : ``,
    `Write ${need} questions. Aim for the mix ${MIX.easy} easy / ${MIX.medium} medium / ${MIX.hard} hard`,
    `across the full pack of ${PACK}. Write fewer than ${need} rather than reaching for anything`,
    `the dossier does not support.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildOne(fixtureId, { dryRun, outDir }) {
  const log = (m) => console.error(`  · ${m}`);
  const { facts, whitelist, clubs, report } = await mineBaseFacts({ fixtureId, log });
  const matchday = londonDay(report.kickoff);

  console.error(
    `· ${report.home} v ${report.away}: ${report.factsMined} facts mined ` +
      `(h2h ${report.h2hUsable} usable / ${report.h2hWithEvents} with goalscorers; ` +
      `FIFA seasons ${Object.entries(report.fifa).map(([k, v]) => `${k}:${v}`).join(" ")})`,
  );

  const system = readFileSync(PROMPT, "utf8");
  const ctx = makeContext({
    fixtureId,
    kickoff: report.kickoff,
    homeId: (await sm.participants(await sm.fixture(fixtureId, "participants"))).home.id,
    awayId: (await sm.participants(await sm.fixture(fixtureId, "participants"))).away.id,
  });

  const byId = new Map(facts.map((f) => [f.id, f]));
  const kept = [];
  const allDropped = [];

  // Bounded rounds: ask for what's still missing, never more than MAX_ROUNDS.
  for (let round = 1; round <= MAX_ROUNDS && kept.length < PACK; round++) {
    const need = PACK - kept.length;
    const res = await writeQuestions({
      system,
      prompt: renderPrompt({
        report,
        facts,
        whitelist,
        need,
        avoid: kept.map((q) => q.question),
      }),
      maxTokens: 6000,
    });
    if (res.refused) {
      console.error("  ✗ model refused — leaving the slate short");
      break;
    }

    const withClaims = res.questions.map((q) => {
      const cited = (q.fact_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
      return {
        question: q.question,
        options: q.options,
        answer: q.answer,
        difficulty: q.difficulty,
        named_entities: q.named_entities ?? [],
        claims: cited.flatMap((f) => f.claims),
        provenance: cited.map((f) => f.source),
      };
    });

    const { kept: validated, dropped } = await validateQuestions(withClaims, {
      pass: "base",
      whitelist,
      clubs,
      ctx,
    });
    for (const d of dropped) {
      console.error(`  ✗ DROPPED: ${d.question}`);
      for (const r of d.reasons) console.error(`      · ${r}`);
    }
    allDropped.push(...dropped);

    // Season-wide dedup (AC6): reverse fixtures recur and the H2H facts don't
    // change, so a question already in the active bank or in ANY halftime pack
    // this season is out. Checked server-side with the canonical normalization.
    let ok = validated;
    if (validated.length) {
      const collisions = new Set(
        await api.dedupCheck(validated.map((q) => q.question), Number(fixtureId)),
      );
      if (collisions.size) {
        for (const i of collisions) {
          console.error(`  ✗ DUPLICATE (bank/season): ${validated[i].question}`);
          allDropped.push({ ...validated[i], reasons: ["duplicate of bank or season halftime question"] });
        }
        ok = validated.filter((_, i) => !collisions.has(i));
      }
    }

    // Dedup within the slate as we go — the same fact phrased twice is one question.
    const seen = new Set(kept.map((q) => normalise(q.question)));
    for (const q of ok) {
      const key = normalise(q.question);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(q);
      if (kept.length === PACK) break;
    }
    console.error(`  · round ${round}: +${ok.length} kept, ${dropped.length} dropped (total ${kept.length}/${PACK})`);
  }

  const slate = {
    fixtureId: Number(fixtureId),
    matchday,
    kickoff: report.kickoff,
    home: report.home,
    away: report.away,
    model: modelId(),
    coverage: report,
    complete: kept.length === PACK,
    questions: kept,
    dropped: allDropped,
    // The provenance sidecar (AC1): every question names the source it stands on.
    provenance: kept.map((q, i) => ({
      n: i + 1,
      question: q.question,
      sources: q.provenance ?? [],
      claims: (q.claims ?? []).map((c) => c.type),
      retrieved: new Date().toISOString(),
    })),
  };

  if (outDir) {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/base-${fixtureId}.json`, JSON.stringify(slate, null, 2));
  }

  if (!dryRun) {
    if (kept.length !== PACK) {
      // The content-write route enforces exactly 10 (validatePackQuestions). A short
      // slate is a real outcome — it goes to the gate as short, it does not go to
      // the DB as fake.
      console.error(`  ! ${kept.length}/${PACK} grounded — NOT persisted; the slate gate must decide`);
      audit(matchday, "base.short", { fixtureId, got: kept.length, coverage: report });
    } else {
      const stripped = kept.map(({ question, options, answer, difficulty }) => ({
        question,
        options,
        answer,
        difficulty,
      }));
      await api.putBase(fixtureId, stripped);
      const back = await api.schedule(matchday);
      const row = (back.fixtures ?? []).find((f) => Number(f.fixture_id) === Number(fixtureId));
      if (!row || row.state !== "base_ready") {
        throw new Error(`persisted base slate but re-read says state=${row?.state}`);
      }
      audit(matchday, "base.persisted", { fixtureId, count: PACK, model: modelId() });
      console.error(`  ✓ ${PACK} base questions persisted, state=base_ready`);
    }
  }

  return slate;
}

const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const date = flag(argv, "--date");
  const one = Number(flag(argv, "--fixture"));
  const dryRun = has(argv, "--dry-run");
  const outDir = flag(argv, "--out");

  if (!date && !one) {
    console.error("usage: gen-base.mjs (--date YYYY-MM-DD | --fixture <id>) [--dry-run] [--out dir]");
    process.exit(2);
  }

  const ent = await sm.assertEntitlements();
  if (!ent.ok) {
    console.error(`✗ SportMonks entitlements missing: ${ent.missing.join(", ")}`);
    process.exit(2);
  }

  let ids = [];
  if (one) ids = [one];
  else {
    const fixtures = await sm.fixturesBetween(date, date);
    ids = fixtures.map((f) => f.id);
    console.error(`· ${date}: ${ids.length} PL fixtures`);
  }

  const slates = [];
  for (const id of ids) {
    try {
      slates.push(await buildOne(id, { dryRun, outDir }));
    } catch (err) {
      console.error(`✗ fixture ${id}: ${err.message}`);
      slates.push({ fixtureId: id, error: err.message, complete: false });
    }
  }

  const short = slates.filter((s) => !s.complete);
  console.error(
    `\n· slate: ${slates.length - short.length}/${slates.length} complete` +
      (short.length ? `; short: ${short.map((s) => s.fixtureId).join(", ")}` : ""),
  );
  if (dryRun) console.log(JSON.stringify(slates, null, 2));
  process.exit(short.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(2);
});
