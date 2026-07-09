// Build the gate-question pool snapshot from live SportMonks (+ FPL for
// prices/ownership until cut). Writes src/data/gates/pool.json — SERVER-ONLY
// data (contains answers); it must never be imported client-side or copied to
// /public. Run via build-pool.sh. Rerunnable any time (deterministic seeds).

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = new URL("../../.tmp-gates-val/lib/gates/", import.meta.url);
const { fetchFplBootstrap, fplToPlayers } = await import(new URL("fpl.js", base));
const { fetchSmSeasonSquads, matchClubs, buildEnrichment, enrichPlayers } = await import(new URL("sportmonks.js", base));
const { generateHigherLower, generateThisSeasonForm } = await import(new URL("higher-lower.js", base));
const { generateWhoAmI } = await import(new URL("who-am-i.js", base));
const { fetchPlSeasons, fetchSeasonStandings, fetchSeasonTopScorers, buildCareers } = await import(new URL("history.js", base));
const { generateTrivia } = await import(new URL("trivia.js", base));
const { generateCareerPath } = await import(new URL("career-path.js", base));

const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) { console.error("SPORTMONKS_API_KEY not set"); process.exit(1); }

const CURRENT_SEASON = 28083; // PL 2026/27
const CAREER_SEASONS = 12; // most recent N seasons for career reconstruction
const SEED = process.env.POOL_SEED ?? new Date().toISOString().slice(0, 10);
const nowYear = new Date().getFullYear();

console.log(`building gate pool (seed ${SEED})…`);

// 1. Current players: FPL base + SportMonks enrichment
const boot = await fetchFplBootstrap();
const players = fplToPlayers(boot);
const { teams, players: smPlayers } = await fetchSmSeasonSquads(CURRENT_SEASON, KEY);
const clubMap = matchClubs(boot.teams.map((t) => ({ id: t.id, name: t.name ?? t.short_name })), teams);
const enriched = enrichPlayers(players, buildEnrichment(players, smPlayers, clubMap, new Date()));
console.log(`players: ${players.length} FPL, ${smPlayers.length} SM squad, clubs mapped ${clubMap.size}/20`);

// 2. Current-football formats
const questions = [
  ...generateHigherLower(enriched, { stat: "price", seed: SEED, count: 60 }),
  ...generateHigherLower(enriched, { stat: "goals", seed: SEED, count: 40 }),
  ...generateThisSeasonForm(enriched, { seed: SEED, count: 50, stat: "points" }),
  ...generateThisSeasonForm(enriched, { seed: SEED, count: 30, stat: "goals" }),
  ...generateWhoAmI(enriched, { seed: SEED, count: 40 }),
];
console.log(`current-football questions: ${questions.length}`);

// 3. Era formats from the historical archive
const seasons = await fetchPlSeasons(KEY);
const past = seasons.filter((s) => s.id !== CURRENT_SEASON && s.startYear <= nowYear - 1);
const history = [];
for (const s of past) {
  try {
    history.push({
      season: s,
      standings: await fetchSeasonStandings(s.id, KEY),
      topScorers: await fetchSeasonTopScorers(s.id, KEY),
    });
  } catch (e) {
    console.log(`  (skip ${s.name}: ${e.message})`);
  }
}
const trivia = generateTrivia(history, { seed: SEED, nowYear });
console.log(`trivia questions: ${trivia.length} (from ${history.length} seasons)`);
questions.push(...trivia);

const careerWindow = past.slice(-CAREER_SEASONS);
const squads = [];
for (const s of careerWindow) {
  try {
    const { players: sp } = await fetchSmSeasonSquads(s.id, KEY);
    squads.push({ season: s, players: sp });
    process.stdout.write(`  squads ${s.name}: ${sp.length}\r\n`);
  } catch (e) {
    console.log(`  (skip squads ${s.name}: ${e.message})`);
  }
}
const careers = buildCareers(squads);
const careerQs = generateCareerPath(careers, { seed: SEED, count: 50, nowYear });
console.log(`career questions: ${careerQs.length} (${careers.length} careers)`);
questions.push(...careerQs);

// 4. Write the snapshot
const byFormat = {};
for (const q of questions) byFormat[q.format] = (byFormat[q.format] ?? 0) + 1;
const pool = { version: SEED, builtAt: new Date().toISOString(), questions };
const out = join(dirname(fileURLToPath(import.meta.url)), "../../src/data/gates/pool.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(pool));
console.log(`\n✅ pool.json written: ${questions.length} questions`, byFormat);
