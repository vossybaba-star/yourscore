#!/usr/bin/env node
/**
 * gen-recap.mjs — the Gameweek Recap Quiz (spec §6). One pack per COMPLETED
 * gameweek, built from what actually happened across all of that gameweek's
 * fixtures: final scores, margins, and who scored.
 *
 * Row shape (open item 3 in the spec, resolved here): BOTH of the two options
 * the spec left open. Migration 110 already added `kind` ('fixture'|'recap')
 * for readers to discriminate on, but `fixture_id` is still `not null unique`
 * (migration 93) — a recap row still needs a placeholder there. So: kind =
 * 'recap' AND fixture_id = a deterministic sentinel keyed on
 * (season_id, gameweek) — src/lib/gameday/shared.ts's recapSentinelFixtureId
 * (negative, never collides with a real positive SportMonks fixture id).
 * Every fixture reader (pl/fixtures, gameday/today, the club-fan leaderboard)
 * filters on kind='fixture', so a recap row can never be mistaken for one.
 *
 * Content: goals, margins, and multi-goal performances, mined purely from
 * completed fixtures' final scores and goal events — the same entitlement
 * base's H2H miner uses (history.mjs), pointed at THIS gameweek's own
 * fixtures instead of past meetings between two clubs. Cards are a
 * DELIBERATE SCOPE CUT for this build: SportMonks event type ids for
 * yellow/red cards were not independently re-verified against live match
 * data (the 2026/27 season has not started — there is nothing to verify
 * against yet), so this miner only mines GOAL/PENALTY events, which are
 * already verified (sm.EVENT_TYPE, exercised daily by the base H2H miner).
 *
 * Same validator (pass='recap' — skips the current-affairs ban, which would
 * otherwise reject "this gameweek" language a recap question has to use),
 * same season-horizon dedup, same approve gate (gate.mjs is kind-agnostic —
 * it reads/writes by fixture_id, and a sentinel id is just a bigint to it).
 * Scores to Rank; pays NO transfer credits (§6, only the club Gameday pack
 * feeds fantasy).
 *
 * Timing rule (implemented here, not in the gate): an unapproved recap still
 * sitting at the next gameweek's first kickoff must never publish late — see
 * --skip-if-next-kickoff-passed below, meant to be checked by whatever calls
 * this script before re-running gen/gate for a stale recap.
 *
 * KNOWN GAP, flagged rather than silently worked around: publishing a
 * kind='recap' row end-to-end needs src/lib/gameday/publish.ts to (a) stop
 * filtering getDueRows() to kind='fixture' only, and (b) branch pack naming/
 * push copy on kind. Neither file is in this workstream's scope (§9 lists
 * publish.ts under no workstream explicitly, and this brief scopes W2 to
 * scripts/health-checks/the content route only) — this script gets a recap
 * pack all the way to `approved`, which is as far as generation+gate can
 * take it. Publishing needs that follow-up change, made explicit here so it
 * isn't lost.
 *
 * CLI:
 *   gen-recap.mjs --season 28083 --gameweek 7 [--dry-run] [--out dir]
 *     [--lookback-days 10]   how far back to search for the gameweek's
 *                            fixtures (default 10 — a gameweek plus slack
 *                            for a postponed makeup match)
 *
 * Exit 0 = a slate was produced (full or short) · 1 = zero facts/questions
 * survived · 2 = hard failure (no completed fixtures found, SportMonks down).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import * as sm from "../halftime/lib/sm.mjs";
import * as api from "../halftime/lib/api.mjs";
import { normName as norm2 } from "../halftime/lib/claims.mjs";
import { writeQuestions, modelId } from "../halftime/lib/llm.mjs";
import { validateQuestions, makeContext } from "./validate.mjs";
import { audit } from "../halftime/lib/audit.mjs";
import { loadEnvFile, flag, has } from "../halftime/lib/env.mjs";
import { parseGameweek } from "./sync-fixtures.mjs";
import { recapSentinelFixtureId } from "../../src/lib/gameday/shared.ts";

const PACK = 11;
const MIX = { easy: 4, medium: 4, hard: 3 };
const PROMPT = "scripts/gameday/prompts/recap.md";
const MAX_ROUNDS = 2; // bounded retry (LOOP rule 3), same bound as gen-base.mjs

const ymd = (d) => d.toISOString().slice(0, 10);

/** Tomorrow's 09:00 Europe/London, as an ISO instant — "gate that evening,
 * publish the next morning" (spec §6). Same double-offset DST trick used
 * throughout this pipeline (shared.ts, gate.mjs's reminderTime) — duplicated
 * rather than imported, same rationale as shared.ts's own header: this stays
 * a standalone .mjs script with one TS import (the sentinel id), not a full
 * shared.ts consumer. */
function recapPublishAt(now = new Date()) {
  const tomorrow = new Date(now.getTime() + 86400000);
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(tomorrow);
  const [y, m, d] = key.split("-").map(Number);
  const off = (dt) => {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/London", hour12: false, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(dt)) p[type] = value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - dt.getTime();
  };
  const guess = new Date(Date.UTC(y, m - 1, d, 9, 0, 0));
  return new Date(guess.getTime() - off(new Date(guess.getTime() - off(guess))));
}

let seq = 0;
function fact({ kind, text, claims, source, difficulty, names = [] }) {
  return { id: `r${++seq}`, kind, text, claims, source, difficulty, names };
}

/**
 * Mine facts from a completed gameweek's own fixtures: final scores, the
 * biggest margin, the highest-scoring match, and any multi-goal ("brace or
 * better") performance. Every fact carries a claim validate.mjs can
 * re-resolve — h2h_result (reused verbatim: the resolver doesn't care WHY a
 * fixture's score is being asserted, only that it's true and strictly before
 * ctx.kickoff) and fixture_scorer (new, §6, single-fixture goal tally).
 */
export async function mineRecapFacts({ season, gameweek, lookbackDays = 10, windowFrom, windowTo, log = () => {} }) {
  seq = 0;
  // windowFrom/windowTo are an explicit override for re-running an older or
  // missed gameweek (SportMonks' /fixtures/between rejects windows over
  // ~100 days, so "just widen lookback" doesn't reach an arbitrary past
  // gameweek) — normal operation just uses lookbackDays before today.
  const to = windowTo ?? ymd(new Date());
  const from = windowFrom ?? ymd(new Date(Date.now() - lookbackDays * 86400000));
  const all = await sm.fixturesBetween(from, to);
  const fixtures = all.filter(
    (f) => Number(f.season_id) === Number(season) && parseGameweek(f.round?.name) === Number(gameweek),
  );
  log(`fixtures matching season ${season} / gameweek ${gameweek} in [${from}, ${to}]: ${fixtures.length}`);
  if (!fixtures.length) {
    throw new Error(`no fixtures found for season ${season} gameweek ${gameweek} in window [${from}, ${to}] — widen --lookback-days`);
  }

  const detailed = [];
  for (const f of fixtures) {
    const fx = await sm.fixture(f.id, "participants;scores;events;league");
    const p = sm.participants(fx);
    const s = sm.finalScore(fx);
    if (!p || !s) {
      log(`  ! fixture ${f.id} has no final score yet — skipped (still to be played / postponed)`);
      continue;
    }
    detailed.push({ fx, p, s });
  }
  if (!detailed.length) {
    throw new Error(`gameweek ${gameweek} has ${fixtures.length} fixture(s) tracked but none completed yet`);
  }
  log(`completed fixtures: ${detailed.length}/${fixtures.length}`);

  const facts = [];
  const whitelist = [];
  const clubs = new Set();
  for (const { p } of detailed) {
    clubs.add(p.home.name);
    clubs.add(p.away.name);
  }

  // ── 1. Every completed fixture's final score ───────────────────────────────
  for (const { fx, p, s } of detailed) {
    facts.push(
      fact({
        kind: "gw_result",
        text: `${p.home.name} ${s.home}-${s.away} ${p.away.name} (Gameweek ${gameweek}).`,
        claims: [
          {
            type: "h2h_result",
            fixture_id: fx.id,
            date: String(fx.starting_at).slice(0, 10),
            home: p.home.name,
            away: p.away.name,
            home_goals: s.home,
            away_goals: s.away,
          },
        ],
        source: `SportMonks fixture ${fx.id}`,
        difficulty: "easy",
      }),
    );
  }

  // ── 2. Biggest winning margin ───────────────────────────────────────────────
  let biggest = null;
  for (const d of detailed) {
    if (d.s.home === d.s.away) continue; // a draw has no margin
    const margin = Math.abs(d.s.home - d.s.away);
    if (!biggest || margin > biggest.margin) biggest = { ...d, margin };
  }
  if (biggest && biggest.margin >= 2) {
    facts.push(
      fact({
        kind: "gw_biggest_margin",
        text:
          `ASK: which Gameweek ${gameweek} fixture had the biggest winning margin? ` +
          `(${biggest.p.home.name} ${biggest.s.home}-${biggest.s.away} ${biggest.p.away.name}, a ${biggest.margin}-goal margin.)`,
        claims: [
          {
            type: "h2h_result",
            fixture_id: biggest.fx.id,
            date: String(biggest.fx.starting_at).slice(0, 10),
            home: biggest.p.home.name,
            away: biggest.p.away.name,
            home_goals: biggest.s.home,
            away_goals: biggest.s.away,
          },
        ],
        source: `SportMonks fixture ${biggest.fx.id}`,
        difficulty: "medium",
      }),
    );
  }

  // ── 3. Highest-scoring match ─────────────────────────────────────────────────
  let highest = null;
  for (const d of detailed) {
    const total = d.s.home + d.s.away;
    if (!highest || total > highest.total) highest = { ...d, total };
  }
  if (highest && highest.total >= 4 && (!biggest || highest.fx.id !== biggest.fx.id)) {
    facts.push(
      fact({
        kind: "gw_highest_scoring",
        text:
          `ASK: which Gameweek ${gameweek} fixture produced the most goals? ` +
          `(${highest.p.home.name} ${highest.s.home}-${highest.s.away} ${highest.p.away.name}, ${highest.total} goals.)`,
        claims: [
          {
            type: "h2h_result",
            fixture_id: highest.fx.id,
            date: String(highest.fx.starting_at).slice(0, 10),
            home: highest.p.home.name,
            away: highest.p.away.name,
            home_goals: highest.s.home,
            away_goals: highest.s.away,
          },
        ],
        source: `SportMonks fixture ${highest.fx.id}`,
        difficulty: "medium",
      }),
    );
  }

  // ── 4. Multi-goal performances (brace or better) ────────────────────────────
  // Same GOAL/PENALTY-only, own-goal-excluded rule as history.mjs's scorerTally.
  for (const { fx, p, s } of detailed) {
    const tally = new Map();
    for (const e of fx.events ?? []) {
      if (e.type_id !== sm.EVENT_TYPE.GOAL && e.type_id !== sm.EVENT_TYPE.PENALTY) continue;
      if (!e.player_name) continue;
      const key = e.player_id != null ? `id:${e.player_id}` : `name:${norm2(e.player_name)}`;
      const rec = tally.get(key) ?? { goals: 0, name: String(e.player_name).trim(), player_id: e.player_id ?? null };
      rec.goals++;
      if (String(e.player_name).trim().length > rec.name.length) rec.name = String(e.player_name).trim();
      tally.set(key, rec);
    }
    for (const rec of tally.values()) {
      if (rec.goals < 2) continue;
      whitelist.push(rec.name);
      facts.push(
        fact({
          kind: "gw_scorer",
          text: `ASK: who scored ${rec.goals} goals in ${p.home.name} ${s.home}-${s.away} ${p.away.name} in Gameweek ${gameweek}? (${rec.name}.)`,
          claims: [
            { type: "fixture_scorer", fixture_id: fx.id, player_id: rec.player_id, name: rec.name, goals: rec.goals },
          ],
          source: `SportMonks fixture ${fx.id} events`,
          difficulty: rec.goals >= 3 ? "hard" : "medium",
          names: [rec.name],
        }),
      );
    }
  }

  const report = {
    seasonId: Number(season),
    gameweek: Number(gameweek),
    fixturesTracked: fixtures.length,
    fixturesCompleted: detailed.length,
    factsMined: facts.length,
    smCalls: sm.calls(),
  };

  return { facts, whitelist: [...new Set(whitelist)], clubs: [...clubs], report, detailed };
}

function renderPrompt({ gameweek, facts, whitelist, need, avoid }) {
  const lines = facts.map((f) => `[${f.id}] ${f.text}`).join("\n");
  return [
    `GAMEWEEK: ${gameweek} (completed)`,
    ``,
    `DOSSIER — what actually happened, all verified. Use nothing else.`,
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

const normalise = (s) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

async function buildOne({ season, gameweek, lookbackDays, windowFrom, windowTo, dryRun, outDir }) {
  const log = (m) => console.error(`  · ${m}`);
  const { facts, whitelist, clubs, report, detailed } = await mineRecapFacts({
    season, gameweek, lookbackDays, windowFrom, windowTo, log,
  });
  console.error(
    `· Gameweek ${gameweek}: ${report.fixturesCompleted}/${report.fixturesTracked} fixtures completed, ${report.factsMined} facts mined`,
  );

  const fixtureId = recapSentinelFixtureId(season, gameweek);
  const lastKickoffMs = Math.max(...detailed.map((d) => new Date(d.fx.starting_at).getTime()));
  // Nominal "kickoff" for the sentinel row: ~2h after the last match's real
  // kickoff, a safe post-full-time anchor. Never read by any fixture UI
  // (kind='recap' rows are filtered out everywhere that renders a kickoff
  // clock) — it exists purely to satisfy the NOT NULL column and to give the
  // h2h_result resolver's pre-kickoff contamination check something strictly
  // after every fixture this gameweek references.
  const kickoffAt = new Date(lastKickoffMs + 2 * 3600_000).toISOString();
  const publishAt = recapPublishAt().toISOString();

  const system = readFileSync(PROMPT, "utf8");
  const ctx = makeContext({ fixtureId, kickoff: kickoffAt, homeId: null, awayId: null });

  const byId = new Map(facts.map((f) => [f.id, f]));
  const kept = [];
  const allDropped = [];

  for (let round = 1; round <= MAX_ROUNDS && kept.length < PACK; round++) {
    const need = PACK - kept.length;
    const res = await writeQuestions({
      system,
      prompt: renderPrompt({ gameweek, facts, whitelist, need, avoid: kept.map((q) => q.question) }),
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
      pass: "recap",
      whitelist,
      clubs,
      ctx,
    });
    for (const d of dropped) {
      console.error(`  ✗ DROPPED: ${d.question}`);
      for (const r of d.reasons) console.error(`      · ${r}`);
    }
    allDropped.push(...dropped);

    // Season-wide dedup (AC4/AC6 equivalent for recap): against the bank,
    // every prior gameday pack this season, and every prior recap pack this
    // season. excludeFixtureId = this recap's own sentinel, so re-running
    // this same gameweek's generation doesn't collide with its own earlier draft.
    let ok = validated;
    if (validated.length) {
      const collisions = new Set(await api.dedupCheck(validated.map((q) => q.question), fixtureId));
      if (collisions.size) {
        for (const i of collisions) {
          console.error(`  ✗ DUPLICATE (bank/season): ${validated[i].question}`);
          allDropped.push({ ...validated[i], reasons: ["duplicate of bank or season gameday/recap question"] });
        }
        ok = validated.filter((_, i) => !collisions.has(i));
      }
    }

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
    seasonId: Number(season),
    gameweek: Number(gameweek),
    fixtureId,
    kickoff: kickoffAt,
    publishAt,
    model: modelId(),
    coverage: report,
    complete: kept.length === PACK,
    questions: kept,
    dropped: allDropped,
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
    writeFileSync(`${outDir}/recap-${season}-gw${gameweek}.json`, JSON.stringify(slate, null, 2));
  }

  if (!dryRun) {
    // The sentinel row must exist before opBase can write to it — same
    // direct-REST exception sync-fixtures.mjs uses, confined here to
    // creating exactly one recap placeholder row per (season, gameweek).
    await api.upsertFixtures([
      {
        fixture_id: fixtureId,
        season_id: Number(season),
        round_name: String(gameweek),
        gameweek: Number(gameweek),
        kind: "recap",
        home: `Gameweek ${gameweek}`,
        away: "Recap",
        kickoff_at: kickoffAt,
        publish_at: publishAt,
      },
    ]);

    if (kept.length !== PACK) {
      console.error(`  ! ${kept.length}/${PACK} grounded — NOT persisted; the slate gate must decide`);
      audit(`recap-${season}-gw${gameweek}`, "recap.short", { season, gameweek, got: kept.length, coverage: report });
    } else {
      const stripped = kept.map(({ question, options, answer, difficulty }) => ({ question, options, answer, difficulty }));
      await api.putBase(fixtureId, stripped);
      const back = await api.readFixturesByIds([fixtureId]);
      const row = back[0];
      if (!row || row.state !== "base_ready") {
        throw new Error(`persisted recap slate but re-read says state=${row?.state}`);
      }
      audit(`recap-${season}-gw${gameweek}`, "recap.persisted", { season, gameweek, count: PACK, model: modelId() });
      console.error(`  ✓ ${PACK} recap questions persisted, state=base_ready, fixture_id=${fixtureId}`);
    }
  }

  return slate;
}

async function main() {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const season = flag(argv, "--season");
  const gameweek = flag(argv, "--gameweek");
  const lookbackDays = Number(flag(argv, "--lookback-days") ?? 10);
  const windowFrom = flag(argv, "--from");
  const windowTo = flag(argv, "--to");
  const dryRun = has(argv, "--dry-run");
  const outDir = flag(argv, "--out");

  if (!season || !gameweek) {
    console.error(
      "usage: gen-recap.mjs --season <id> --gameweek <n> [--dry-run] [--out dir] [--lookback-days N] [--from YYYY-MM-DD --to YYYY-MM-DD]",
    );
    process.exit(2);
  }

  const ent = await sm.assertEntitlements();
  if (!ent.ok) {
    console.error(`✗ SportMonks entitlements missing: ${ent.missing.join(", ")}`);
    process.exit(2);
  }

  try {
    const slate = await buildOne({
      season: Number(season), gameweek: Number(gameweek), lookbackDays, windowFrom, windowTo, dryRun, outDir,
    });
    if (dryRun) console.log(JSON.stringify(slate, null, 2));
    process.exit(slate.complete || slate.questions.length ? 0 : 1);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
