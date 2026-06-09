#!/usr/bin/env node
/**
 * Draft XI — dataset builder.
 *
 * The pool is built ENTIRELY from real FIFA ratings — no hand-made estimates.
 * Source: scripts/draft/data/players.csv (columns: name,club,season,position,
 * overall), produced from the latest EA Sports FC ratings via
 * scripts/draft/import-fifa.mjs (fifaindex.com FC26 / 2025-26 Premier League).
 *
 * Each spin deals one (club, season) bucket. Run: `node scripts/draft/build-dataset.mjs`.
 *
 * Canonical positions: GK RB CB LB RWB LWB CDM CM CAM RW LW ST
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "src", "data", "draft", "player-seasons.json");
const CSV = join(__dirname, "data", "players.csv");

const POSITIONS = new Set(["GK", "RB", "CB", "LB", "RWB", "LWB", "CDM", "CM", "CAM", "RW", "LW", "ST"]);

function slugify(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const seasonSlug = (s) => s.replace("/", "-");

function normalize(name, club, season, position, overall, nationality) {
  if (!POSITIONS.has(position)) throw new Error(`bad position ${position} for ${name}`);
  const clubSlug = slugify(club);
  const id = `${slugify(name)}-${clubSlug}-${seasonSlug(season)}`;
  return { id, name, club, clubSlug, season, position, overall: Math.round(overall), nationality: nationality || "", curated: false };
}

// ── Load real FIFA ratings from the CSV ─────────────────────────────────────
if (!existsSync(CSV)) {
  console.error(`Missing ${CSV} — run scripts/draft/import-fifa.mjs first.`);
  process.exit(1);
}
const byId = new Map();
const rows = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const header = rows.shift().split(",").map((h) => h.trim().toLowerCase());
const col = (r, k) => r[header.indexOf(k)]?.trim();
for (const line of rows) {
  const r = line.split(",");
  const position = (col(r, "position") || "").toUpperCase();
  if (!POSITIONS.has(position)) continue;
  try {
    const p = normalize(col(r, "name"), col(r, "club"), col(r, "season"), position, Number(col(r, "overall")), col(r, "nationality"));
    byId.set(p.id, p);
  } catch { /* skip malformed row */ }
}

const players = [...byId.values()].sort((a, b) => b.overall - a.overall);

// Nationality is per-PERSON, not per-edition. Older editions (pre-FIFA-15) may lack a
// nationality column in Kaggle dumps — backfill any blank from another edition of the
// same player (matched by name identity) so we only need the editions Kaggle provides.
const natByIdentity = new Map();
for (const p of players) if (p.nationality) natByIdentity.set(slugify(p.name), p.nationality);
let backfilled = 0;
for (const p of players) {
  if (!p.nationality) {
    const n = natByIdentity.get(slugify(p.name));
    if (n) { p.nationality = n; backfilled++; }
  }
}
if (backfilled > 0) console.log(`Backfilled nationality for ${backfilled} player-seasons from other editions.`);

// ── Spinnable buckets: (club, season) with enough players to draft from ─────
const bucketMap = new Map();
for (const p of players) {
  const key = `${p.clubSlug}__${seasonSlug(p.season)}`;
  if (!bucketMap.has(key)) bucketMap.set(key, { club: p.club, clubSlug: p.clubSlug, season: p.season, playerIds: [] });
  bucketMap.get(key).playerIds.push(p.id);
}
const MIN_BUCKET = 4; // never deal a club-season too thin to draft from
const buckets = [...bucketMap.values()].filter((b) => b.playerIds.length >= MIN_BUCKET);

// Club strength = mean overall of each club's best XI — the real rivals the season
// simulator plays against, derived from FIFA data (no hand-made numbers).
const clubStrength = (playerIds) => {
  const ovrs = playerIds.map((id) => byId.get(id).overall).sort((a, b) => b - a).slice(0, 11);
  return Math.round(ovrs.reduce((a, b) => a + b, 0) / ovrs.length);
};
const clubs = buckets
  .map((b) => ({ name: b.club, clubSlug: b.clubSlug, season: b.season, strength: clubStrength(b.playerIds) }))
  .sort((a, b) => b.strength - a.strength);

// ── Canonicalise nationality strings (merge dataset label variants; align to the
//    WC 2026 nation names where applicable) ──────────────────────────────────
const NATION_ALIASES = {
  "Holland": "Netherlands",
  "Czech Republic": "Czechia",
  "Korea Republic": "South Korea",
  "Korea DPR": "North Korea",
  "IR Iran": "Iran",
  "China PR": "China",
  "USA": "United States",
  "Côte d'Ivoire": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "Cape Verde Islands": "Cape Verde",
  "DR Congo": "Congo DR",
  "Turkey": "Türkiye",
  "Bosnia and Herzegovina": "Bosnia-Herzegovina",
  "Curacao": "Curaçao",
};
for (const p of players) {
  if (p.nationality && NATION_ALIASES[p.nationality]) p.nationality = NATION_ALIASES[p.nationality];
}

// ── Nation index (World Cup Run mode) ───────────────────────────────────────
// Group players by nationality. Depth is counted by DISTINCT player identity per
// pitch line (not per season) so a star across 8 editions doesn't inflate it.
const LINE = {
  GK: "GK", RB: "DEF", CB: "DEF", LB: "DEF", RWB: "DEF", LWB: "DEF",
  CDM: "MID", CM: "MID", CAM: "MID", RW: "ATT", LW: "ATT", ST: "ATT",
};
const natMap = new Map();
for (const p of players) {
  if (!p.nationality) continue;
  if (!natMap.has(p.nationality)) {
    natMap.set(p.nationality, { nation: p.nationality, playerIds: [], lineIds: { GK: new Set(), DEF: new Set(), MID: new Set(), ATT: new Set() } });
  }
  const n = natMap.get(p.nationality);
  n.playerIds.push(p.id);
  n.lineIds[LINE[p.position]].add(slugify(p.name));
}
// Playable = enough distinct players per line to field an XI in some formation
// AND headroom for the run's upgrade picks. Threshold is tunable.
// You field exactly one GK, so GK>=1 suffices; DEF/MID/ATT carry upgrade headroom.
const PLAYABLE = { GK: 1, DEF: 5, MID: 4, ATT: 3 };
const nations = [...natMap.values()]
  .map((n) => {
    const lines = { GK: n.lineIds.GK.size, DEF: n.lineIds.DEF.size, MID: n.lineIds.MID.size, ATT: n.lineIds.ATT.size };
    return {
      nation: n.nation,
      count: n.playerIds.length,
      lines,
      playable: lines.GK >= PLAYABLE.GK && lines.DEF >= PLAYABLE.DEF && lines.MID >= PLAYABLE.MID && lines.ATT >= PLAYABLE.ATT,
      playerIds: n.playerIds,
    };
  })
  .sort((a, b) => b.count - a.count);
const playableCount = nations.filter((n) => n.playable).length;
const noNationality = players.filter((p) => !p.nationality).length;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "fifa",
  counts: { players: players.length, buckets: buckets.length, csvAdded: players.length, nations: nations.length, playableNations: playableCount, missingNationality: noNationality },
  players,
  buckets,
  clubs,
  nations,
}, null, 0) + "\n");

console.log(`Draft XI dataset: ${players.length} player-seasons, ${buckets.length} spinnable buckets (FIFA only).`);
console.log(`Nations: ${nations.length} total, ${playableCount} playable. Missing nationality: ${noNationality}.`);
if (noNationality > 0) console.warn(`WARN: ${noNationality} player-seasons have no nationality — re-import raw CSVs with a nationality column.`);
console.log(`Wrote ${OUT}`);
