#!/usr/bin/env node
/**
 * validate.mjs — THE HARD GATE. Every question, both passes, before any gate and
 * before any human.
 *
 * A wrong answer in a halftime pack does not fail quietly. It ships to a user
 * MID-MATCH, sitting on screen next to the real scoreline, next to the real team
 * sheet. So this file is deliberately paranoid and deliberately fail-closed:
 * anything it cannot RE-PROVE from data is DROPPED, with a reason, and never
 * flagged for a human to adjudicate. A dropped good question costs us one
 * question. A shipped wrong one costs us the user.
 *
 * Two gates in series:
 *
 *   TEXT GATE (claims.mjs, pure)   shape · grounding · the first-half ban ·
 *                                  the pre-kickoff anchor on mutable stats ·
 *                                  the named-entity whitelist · (base) the
 *                                  current-affairs ban.
 *   DATA GATE (this file)          every claim RE-RESOLVED against live
 *                                  SportMonks (or the owned FIFA dataset). The
 *                                  question does not get to keep the number the
 *                                  miner gave it — we go and look again.
 *
 * The data gate re-derives rather than trusts. `player_goals_vs` is recomputed
 * from the head-to-head goal events with a strict `starting_at < kickoff` filter,
 * so a question can never be validated against a goal from the match that is
 * currently being played.
 *
 * Usage:
 *   node --env-file=.env.local scripts/halftime/validate.mjs \
 *        --fixture 19427175 --in questions.json --pass fresh [--json]
 *
 * Exit: 0 = at least one question survived · 1 = all dropped · 2 = hard failure.
 */

import { readFileSync } from "node:fs";
import * as sm from "./lib/sm.mjs";
import { loadFifa, fifaClubFor } from "./lib/history.mjs";
import {
  textViolations,
  buildNameIndex,
  normName,
  knownClaimType,
} from "./lib/claims.mjs";
import { loadEnvFile, flag, has } from "./lib/env.mjs";

// ── Claim resolvers ──────────────────────────────────────────────────────────
// Each returns { ok: boolean, why?: string }. Anything that throws, returns
// nothing, or disagrees by a single unit is a drop.

async function resolvePlayerInLineup(c, ctx) {
  const fx = await ctx.lineup();
  const inXi = sm
    .starters(fx, c.team_id)
    .some((l) => Number(l.player_id) === Number(c.player_id));
  if (inXi) return { ok: true };
  const onBench = sm
    .bench(fx, c.team_id)
    .some((l) => Number(l.player_id) === Number(c.player_id));
  return {
    ok: false,
    why: onBench
      ? `${c.name} is on the bench, not in the confirmed XI`
      : `${c.name} (id ${c.player_id}) is not in ${c.team_id}'s confirmed team sheet`,
  };
}

async function resolvePlayerCareerClub(c, ctx) {
  const p = await ctx.player(c.player_id);
  if (!p) return { ok: false, why: `player ${c.player_id} not found` };
  const clubs = sm.careerClubIds(p);
  return clubs.has(Number(c.team_id))
    ? { ok: true }
    : { ok: false, why: `${c.name} has no recorded spell at ${c.club} (team ${c.team_id})` };
}

async function resolvePlayerDebutClub(c, ctx) {
  const p = await ctx.player(c.player_id);
  if (!p) return { ok: false, why: `player ${c.player_id} not found` };
  const apps = sm.statTotal(p, sm.STAT.APPEARANCES, { teamId: c.team_id });
  return apps === null || apps === 0
    ? { ok: true }
    : { ok: false, why: `${c.name} already has ${apps} recorded appearances for ${c.club} — not a debut` };
}

async function resolvePlayerStat(c, ctx) {
  const p = await ctx.player(c.player_id);
  if (!p) return { ok: false, why: `player ${c.player_id} not found` };
  const map = {
    appearances: sm.STAT.APPEARANCES,
    goals: sm.STAT.GOALS,
    assists: sm.STAT.ASSISTS,
    minutes: sm.STAT.MINUTES_PLAYED,
    cleansheets: sm.STAT.CLEANSHEET,
    hattricks: sm.STAT.HATTRICKS,
  };
  const id = map[c.stat];
  if (!id) return { ok: false, why: `unknown stat "${c.stat}"` };
  const actual = sm.statTotal(p, id, { teamId: c.team_id, seasonId: c.season_id });
  if (actual === null) return { ok: false, why: `no ${c.stat} recorded for ${c.name} at ${c.club ?? c.team_id}` };
  // Exact match. A milestone question that is one appearance out is a wrong answer.
  return actual === c.value
    ? { ok: true }
    : { ok: false, why: `${c.name} ${c.stat}: claimed ${c.value}, SportMonks says ${actual}` };
}

/**
 * Recomputed from head-to-head goal events, NOT trusted from the claim, and with
 * a hard `starting_at < kickoff` filter. This is the single most important
 * resolver in the file: it is the one that would otherwise let a goal scored in
 * the first half of the match we are releasing into validate a question about it.
 */
async function resolvePlayerGoalsVs(c, ctx) {
  const meetings = await ctx.h2h();
  const before = meetings.filter((m) => new Date(m.starting_at) < new Date(ctx.kickoff));
  let goals = 0;
  const matches = new Set();
  let best = 0;
  for (const m of before) {
    let inThis = 0;
    for (const e of m.events ?? []) {
      if (e.type_id !== sm.EVENT_TYPE.GOAL && e.type_id !== sm.EVENT_TYPE.PENALTY) continue;
      const byId = c.player_id != null && Number(e.player_id) === Number(c.player_id);
      const byName = c.player_id == null && normName(e.player_name) === normName(c.name);
      if (byId || byName) inThis++;
    }
    if (inThis > 0) {
      goals += inThis;
      matches.add(m.id);
      if (inThis > best) best = inThis;
    }
  }
  if (goals !== c.value) {
    return { ok: false, why: `${c.name} goals vs ${c.opponent}: claimed ${c.value}, recomputed ${goals} from pre-kickoff events` };
  }
  if (c.best_in_match != null && best !== c.best_in_match) {
    return { ok: false, why: `${c.name} best haul vs ${c.opponent}: claimed ${c.best_in_match}, recomputed ${best}` };
  }
  return { ok: true };
}

async function resolvePlayerAge(c, ctx) {
  const p = await ctx.player(c.player_id);
  if (!p?.date_of_birth) return { ok: false, why: `no date of birth for ${c.name}` };
  if (String(p.date_of_birth).slice(0, 10) !== c.dob) {
    return { ok: false, why: `${c.name} dob: claimed ${c.dob}, SportMonks says ${p.date_of_birth}` };
  }
  return { ok: true };
}

async function resolveFormation(c, ctx) {
  const fx = await ctx.lineup();
  const actual = sm.formationOf(fx, c.team_id);
  return actual === c.formation
    ? { ok: true }
    : { ok: false, why: `formation: claimed ${c.formation}, team sheet says ${actual ?? "none"}` };
}

async function resolveH2hResult(c, ctx) {
  const fx = await sm.fixture(c.fixture_id, "participants;scores");
  if (!fx) return { ok: false, why: `fixture ${c.fixture_id} not found` };
  if (new Date(fx.starting_at) >= new Date(ctx.kickoff)) {
    return { ok: false, why: `fixture ${c.fixture_id} is not strictly before kick-off — first-half contamination` };
  }
  const s = sm.finalScore(fx);
  if (!s) return { ok: false, why: `no final score for fixture ${c.fixture_id}` };
  return s.home === c.home_goals && s.away === c.away_goals
    ? { ok: true }
    : { ok: false, why: `fixture ${c.fixture_id}: claimed ${c.home_goals}-${c.away_goals}, actual ${s.home}-${s.away}` };
}

async function resolveH2hTally(c, ctx) {
  const meetings = await ctx.h2h();
  const past = meetings
    .filter((m) => Number(m.id) !== Number(ctx.fixtureId))
    .filter((m) => new Date(m.starting_at) < new Date(ctx.kickoff))
    .filter((m) => sm.finalScore(m) !== null);
  let a = 0, b = 0, d = 0;
  for (const m of past) {
    const p = sm.participants(m);
    const s = sm.finalScore(m);
    if (!p || !s) continue;
    const aWasHome = p.home.id === c.team_a;
    const ga = aWasHome ? s.home : s.away;
    const gb = aWasHome ? s.away : s.home;
    if (ga > gb) a++;
    else if (gb > ga) b++;
    else d++;
  }
  if (past.length !== c.played || a !== c.wins_a || b !== c.wins_b || d !== c.draws) {
    return {
      ok: false,
      why: `h2h tally: claimed ${c.wins_a}/${c.draws}/${c.wins_b} in ${c.played}, recomputed ${a}/${d}/${b} in ${past.length}`,
    };
  }
  return { ok: true };
}

function resolveFifaRating(c) {
  const players = loadFifa();
  const club = c.club && fifaClubFor(c.club, players);
  const hit = players.find(
    (p) =>
      normName(p.name) === normName(c.name) &&
      (!club || p.club === club) &&
      (!c.season || p.season === c.season),
  );
  if (!hit) return { ok: false, why: `${c.name} not in the FIFA dataset for ${c.club} ${c.season ?? ""}`.trim() };
  if (c.overall != null && hit.overall !== c.overall) {
    return { ok: false, why: `${c.name} rating: claimed ${c.overall}, dataset says ${hit.overall}` };
  }
  return { ok: true };
}

function resolveFifaTop(c) {
  const players = loadFifa();
  const club = fifaClubFor(c.club, players);
  if (!club) return { ok: false, why: `no FIFA-dataset coverage for ${c.club}` };
  const inSeason = players
    .filter((p) => p.club === club && p.season === c.season)
    .sort((a, b) => b.overall - a.overall);
  if (!inSeason.length) return { ok: false, why: `no ${club} ${c.season} squad in the FIFA dataset` };
  const top = inSeason[0];
  if (normName(top.name) !== normName(c.name)) {
    return { ok: false, why: `top-rated ${club} ${c.season}: claimed ${c.name}, dataset says ${top.name}` };
  }
  if (c.overall != null && top.overall !== c.overall) {
    return { ok: false, why: `${c.name} rating: claimed ${c.overall}, dataset says ${top.overall}` };
  }
  return { ok: true };
}

/**
 * The negative claim. Used to prove a DISTRACTOR is genuinely wrong — that the
 * dataset has no record of this player at this club at all. Without it, "which of
 * these played for both Arsenal and Everton?" can ship with two correct answers.
 */
function resolveFifaAbsent(c) {
  const players = loadFifa();
  const club = fifaClubFor(c.club, players);
  if (!club) return { ok: true }; // no coverage → nobody is recorded there → absent
  const hit = players.find((p) => p.club === club && normName(p.name) === normName(c.name));
  return hit
    ? { ok: false, why: `${c.name} IS recorded at ${club} (${hit.season}) — not a safe wrong answer` }
    : { ok: true };
}

const RESOLVERS = {
  player_in_lineup: resolvePlayerInLineup,
  player_career_club: resolvePlayerCareerClub,
  player_debut_club: resolvePlayerDebutClub,
  player_stat: resolvePlayerStat,
  player_goals_vs: resolvePlayerGoalsVs,
  player_age: resolvePlayerAge,
  formation: resolveFormation,
  h2h_result: resolveH2hResult,
  h2h_tally: resolveH2hTally,
  fifa_rating: async (c) => resolveFifaRating(c),
  fifa_top: async (c) => resolveFifaTop(c),
  fifa_absent: async (c) => resolveFifaAbsent(c),
};

/** Lazy, memoised per-fixture data access — keeps a 10-question validation to ~4 calls. */
export function makeContext({ fixtureId, kickoff, homeId, awayId }) {
  let lineupP = null;
  let h2hP = null;
  const players = new Map();
  return {
    fixtureId: Number(fixtureId),
    kickoff,
    lineup: () => (lineupP ??= sm.fixtureLineup(fixtureId)),
    h2h: () => (h2hP ??= sm.headToHead(homeId, awayId)),
    player: (id) => {
      if (!players.has(id)) players.set(id, sm.player(id));
      return players.get(id);
    },
  };
}

/**
 * The gate. Returns { kept, dropped } — `dropped` carries the reasons, which are
 * what the slate report and the veto message show.
 *
 * @param {object[]} questions  each with .claims (attached from the dossier)
 * @param {'base'|'fresh'} pass
 */
export async function validateQuestions(questions, { pass, whitelist, clubs, ctx }) {
  const nameIndex = buildNameIndex(whitelist, clubs);
  const kept = [];
  const dropped = [];

  for (const q of questions) {
    const reasons = textViolations(q, { pass, nameIndex, clubs });

    if (!reasons.length) {
      for (const c of q.claims ?? []) {
        if (!knownClaimType(c)) {
          reasons.push(`unknown claim type ${c?.type}`);
          continue;
        }
        try {
          const r = await RESOLVERS[c.type](c, ctx);
          if (!r.ok) reasons.push(r.why ?? `claim ${c.type} did not resolve`);
        } catch (err) {
          // Cannot re-prove it → cannot ship it. An outage drops the slice; it
          // never waves a question through.
          reasons.push(`claim ${c.type} could not be resolved: ${err.message}`);
        }
      }
    }

    if (reasons.length) dropped.push({ question: q.question, reasons });
    else kept.push(q);
  }
  return { kept, dropped };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const fixtureId = Number(flag(argv, "--fixture"));
  const inPath = flag(argv, "--in");
  const pass = flag(argv, "--pass") || "fresh";
  const asJson = has(argv, "--json");

  if (!fixtureId || !inPath) {
    console.error("usage: validate.mjs --fixture <id> --in <questions.json> [--pass base|fresh] [--json]");
    process.exit(2);
  }

  try {
    const payload = JSON.parse(readFileSync(inPath, "utf8"));
    const questions = payload.questions ?? payload;
    const fx = await sm.fixture(fixtureId, "participants");
    const parts = sm.participants(fx);
    if (!parts) throw new Error("fixture has no participants");

    const ctx = makeContext({
      fixtureId,
      kickoff: payload.kickoff ?? fx.starting_at,
      homeId: parts.home.id,
      awayId: parts.away.id,
    });

    const { kept, dropped } = await validateQuestions(questions, {
      pass,
      whitelist: payload.whitelist ?? [],
      clubs: payload.clubs ?? [parts.home.name, parts.away.name],
      ctx,
    });

    if (asJson) {
      console.log(JSON.stringify({ kept, dropped }, null, 2));
    } else {
      console.log(`✓ kept ${kept.length}  ✗ dropped ${dropped.length}`);
      for (const d of dropped) {
        console.log(`\n  DROPPED: ${d.question}`);
        for (const r of d.reasons) console.log(`    · ${r}`);
      }
    }
    process.exit(kept.length ? 0 : 1);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
}
